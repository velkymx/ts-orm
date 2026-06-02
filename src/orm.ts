import type { ResultSetHeader } from 'mysql2';
import { validatePayload } from './validator.js';
import { castWriteValue } from './casts.js';
import type { Field } from './validator.js';
import type { OrmResponse } from './QueryBuilder.js';
import { runQuery, formatResponse, firstRow, limitOffsetClause } from './db.js';
import { validateAndEscapeIdentifier, validateQualifiedIdentifier, sanitizeError } from './security.js';

// Query shaping options shared by read/readWith.
export interface ReadOptions {
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number | string;
    offset?: number | string;
}

// A join definition for readWith: `on` is a [left, right] pair of qualified
// (table.column) identifiers.
export interface JoinSpec {
    type?: string;
    table: string;
    on: [string, string];
}

export async function create(table: string, struct: Field[], payload: Record<string, unknown>): Promise<OrmResponse> {
    const errors = validatePayload(struct, payload, { skipAutoIncrement: true });
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    try {
        // Validate and escape table name
        const safeTable = validateAndEscapeIdentifier(table, 'table name');

        // Columns whose value resolves to a server-side default keyword are
        // omitted from the INSERT so MySQL computes them (auto_increment ids,
        // CURRENT_TIMESTAMP columns). Binding the literal string e.g.
        // 'current_timestamp' would otherwise insert that text into the column.
        const SERVER_DEFAULTS = new Set(['auto_increment', 'current_timestamp']);
        const insertFields = struct.filter(f => {
            const value = payload[f.name] ?? f.default;
            return !(typeof value === 'string' && SERVER_DEFAULTS.has(value));
        });
        const columns = insertFields.map(f => f.name);
        const values = insertFields.map(f => castWriteValue(payload[f.name] ?? f.default, f));

        // Validate and escape column names
        const safeColumns = columns.map(col => validateAndEscapeIdentifier(col, 'column name'));

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${safeTable} (${safeColumns.join(', ')}) VALUES (${placeholders})`;

        const [result] = await runQuery(sql, values);
        return formatResponse(true, 'Record created', { id: (result as ResultSetHeader).insertId });
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'create', { table }));
    }
}


export async function read<T = Record<string, unknown>>(table: string, conditions: Record<string, unknown> = {}, options: ReadOptions = {}): Promise<OrmResponse<T[]>> {
    try {
        // Validate and escape table name
        const safeTable = validateAndEscapeIdentifier(table, 'table name');

        const keys = Object.keys(conditions);

        // Validate and escape WHERE column names
        const whereClause = keys.length
            ? `WHERE ${keys.map(k => `${validateAndEscapeIdentifier(k, 'column name')} = ?`).join(' AND ')}`
            : '';

        // Validate and escape ORDER BY column
        const orderClause = options.orderBy
            ? `ORDER BY ${validateAndEscapeIdentifier(options.orderBy, 'order by column')} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`
            : '';

        // Parse to numbers; the shared builder handles the OFFSET-needs-LIMIT rule.
        const limit = options.limit != null ? Number.parseInt(String(options.limit), 10) : null;
        const offset = options.offset != null ? Number.parseInt(String(options.offset), 10) : null;
        const limitOffset = limitOffsetClause(limit, offset);

        const sql = `SELECT * FROM ${safeTable} ${whereClause} ${orderClause} ${limitOffset}`.trim();

        const [rows] = await runQuery(sql, keys.map(k => conditions[k]));
        // Rows typed as T[] by the caller's generic; failure branch is loosely
        // typed (success path is sound).
        return formatResponse(true, 'Data retrieved', rows) as OrmResponse<T[]>;
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'read', { table })) as OrmResponse<T[]>;
    }
}

export async function readOne<T = Record<string, unknown>>(table: string, conditions: Record<string, unknown> = {}): Promise<OrmResponse<T>> {
    return firstRow(await read<T>(table, conditions)) as OrmResponse<T>;
}

export async function findOrFail<T = Record<string, unknown>>(table: string, key: string, value: unknown): Promise<OrmResponse<T>> {
    // Consistent contract: every op returns the {success,message,data} envelope.
    // readOne already yields 'Record found' / 'Record not found' — return it
    // directly rather than throwing.
    return readOne<T>(table, { [key]: value });
}

export async function readWith<T = Record<string, unknown>>(table: string, conditions: Record<string, unknown> = {}, joins: JoinSpec[] = [], options: ReadOptions = {}): Promise<OrmResponse<T[]>> {
    try {
        // Validate and escape main table name
        const safeTable = validateAndEscapeIdentifier(table, 'table name');

        const whereKeys = Object.keys(conditions);

        // Validate and escape WHERE column names
        const whereClause = whereKeys.length
            ? `WHERE ${whereKeys.map(k => `${safeTable}.${validateAndEscapeIdentifier(k, 'column name')} = ?`).join(' AND ')}`
            : '';

        // Validate and escape JOIN clauses
        const joinClause = joins.map(join => {
            const joinType = (join.type || 'inner').toUpperCase(); // INNER, LEFT, RIGHT

            // Validate and escape join table name
            const safeJoinTable = validateAndEscapeIdentifier(join.table, 'join table name');

            const [leftCol, rightCol] = join.on;

            // Validate qualified identifiers (table.column)
            if (!validateQualifiedIdentifier(leftCol)) {
                throw new Error(`Invalid join condition: ${leftCol}`);
            }
            if (!validateQualifiedIdentifier(rightCol)) {
                throw new Error(`Invalid join condition: ${rightCol}`);
            }

            // Split and escape each part. validateQualifiedIdentifier already
            // guaranteed a `table.column` shape, so both parts are present; `?? ''`
            // only satisfies the type checker (an empty part would be rejected by
            // validateAndEscapeIdentifier anyway).
            const [leftTable, leftField] = leftCol.split('.');
            const [rightTable, rightField] = rightCol.split('.');
            const safeLeftCol = `${validateAndEscapeIdentifier(leftTable ?? '', 'table name')}.${validateAndEscapeIdentifier(leftField ?? '', 'column name')}`;
            const safeRightCol = `${validateAndEscapeIdentifier(rightTable ?? '', 'table name')}.${validateAndEscapeIdentifier(rightField ?? '', 'column name')}`;

            return `${joinType} JOIN ${safeJoinTable} ON ${safeLeftCol} = ${safeRightCol}`;
        }).join(' ');

        // Validate and escape ORDER BY (handle both qualified and simple)
        let orderClause = '';
        if (options.orderBy) {
            if (validateQualifiedIdentifier(options.orderBy)) {
                // Qualified identifier (table.column)
                const [orderTable, orderField] = options.orderBy.split('.');
                const safeOrderBy = `${validateAndEscapeIdentifier(orderTable ?? '', 'table name')}.${validateAndEscapeIdentifier(orderField ?? '', 'column name')}`;
                orderClause = `ORDER BY ${safeOrderBy} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
            } else {
                // Simple identifier
                orderClause = `ORDER BY ${validateAndEscapeIdentifier(options.orderBy, 'order by column')} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
            }
        }

        // Parse to numbers; the shared builder handles the OFFSET-needs-LIMIT rule.
        const limit = options.limit != null ? Number.parseInt(String(options.limit), 10) : null;
        const offset = options.offset != null ? Number.parseInt(String(options.offset), 10) : null;
        const limitOffset = limitOffsetClause(limit, offset);

        const sql = `SELECT * FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitOffset}`.trim();

        const values = whereKeys.map(k => conditions[k]);

        const [rows] = await runQuery(sql, values);

        return formatResponse(true, 'Data retrieved with join', rows) as OrmResponse<T[]>;
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'readWith', { table })) as OrmResponse<T[]>;
    }
}



export async function update(table: string, struct: Field[], payload: Record<string, unknown>, idKey: string = 'id'): Promise<OrmResponse> {
    // Updates are partial by nature (only provided columns are written), so
    // required fields that are absent from the payload must not fail validation.
    const errors = validatePayload(struct, payload, { partial: true });
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    try {
        // Validate and escape table name and idKey
        const safeTable = validateAndEscapeIdentifier(table, 'table name');
        const safeIdKey = validateAndEscapeIdentifier(idKey, 'id column name');

        // Single pass over the struct: the columns to SET and their bound values
        // are derived from the same filtered field list (avoids a second filter).
        const setFields = struct.filter(f => payload[f.name] !== undefined && f.name !== idKey);
        const updates = setFields.map(f => `${validateAndEscapeIdentifier(f.name, 'column name')} = ?`);
        const values = setFields.map(f => castWriteValue(payload[f.name], f));

        // Nothing to SET (only the id key, or no matching columns) would produce
        // `UPDATE ... SET  WHERE id = ?`, a SQL parse error. Fail cleanly instead.
        if (updates.length === 0) {
            return formatResponse(false, 'No fields to update', []);
        }

        values.push(payload[idKey]);
        const sql = `UPDATE ${safeTable} SET ${updates.join(', ')} WHERE ${safeIdKey} = ?`;

        const [result] = await runQuery(sql, values);
        return formatResponse(true, 'Record updated', result);
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'update', { table }));
    }
}

export async function remove(table: string, idKey: string, idVal: unknown): Promise<OrmResponse> {
    try {
        // Validate and escape table name and idKey
        const safeTable = validateAndEscapeIdentifier(table, 'table name');
        const safeIdKey = validateAndEscapeIdentifier(idKey, 'id column name');

        const sql = `DELETE FROM ${safeTable} WHERE ${safeIdKey} = ?`;

        const values: unknown[] = [idVal];
        const [result] = await runQuery(sql, values);
        return formatResponse(true, 'Record deleted', result);
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'remove', { table }));
    }
}
