import mysql from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import dotenv from 'dotenv';
import { validatePayload } from './validator.js';
import type { Field } from './validator.js';
import type { OrmResponse } from './QueryBuilder.js';
import { validateAndEscapeIdentifier, validateQualifiedIdentifier, sanitizeError } from './security.js';

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    // Honor a configurable port; falls back to MySQL's default 3306 when unset.
    // Required so the suite can target an ephemeral mysqld on a random port.
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

// Query shaping options shared by read/readWith.
export interface ReadOptions {
    orderBy?: string;
    direction?: string;
    limit?: number | string;
    offset?: number | string;
}

// A join definition for readWith: `on` is a [left, right] pair of qualified
// (table.column) identifiers.
export interface JoinSpec {
    type?: string;
    table: string;
    on: [string, string] | string[];
}

function formatResponse(success: boolean, message: string, data: unknown = null): OrmResponse {
    return { success, message, data };
}

export async function create(table: string, struct: Field[], payload: Record<string, any>): Promise<OrmResponse> {
    const errors = validatePayload(struct, payload, { skipAutoIncrement: true });
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    try {
        // Validate and escape table name
        const safeTable = validateAndEscapeIdentifier(table, 'table name');

        // Filter out auto_increment fields
        const filtered = struct.filter(f => f.default !== 'auto_increment');
        const columns = filtered.map(f => f.name);
        const values = filtered.map(f => payload[f.name] ?? f.default);

        // Validate and escape column names
        const safeColumns = columns.map(col => validateAndEscapeIdentifier(col, 'column name'));

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${safeTable} (${safeColumns.join(', ')}) VALUES (${placeholders})`;

        const [result] = await pool.execute(sql, values);
        return formatResponse(true, 'Record created', { id: (result as ResultSetHeader).insertId });
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'create', { table }));
    }
}


export async function read(table: string, conditions: Record<string, any> = {}, options: ReadOptions = {}): Promise<OrmResponse> {
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

        // MySQL requires LIMIT before OFFSET; emit the max-row sentinel when an
        // offset is supplied without a limit. != null honors an explicit 0.
        const limit = options.limit != null ? Number.parseInt(String(options.limit), 10) : null;
        const offset = options.offset != null ? Number.parseInt(String(options.offset), 10) : null;
        const limitClause = limit != null ? `LIMIT ${limit}` : '';
        const offsetClause = offset != null
            ? (limit != null ? `OFFSET ${offset}` : `LIMIT 18446744073709551615 OFFSET ${offset}`)
            : '';

        const sql = `SELECT * FROM ${safeTable} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

        const [rows] = await pool.execute(sql, keys.map(k => conditions[k]));
        return formatResponse(true, 'Data retrieved', rows);
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'read', { table }));
    }
}

export async function readOne(table: string, conditions: Record<string, any> = {}): Promise<OrmResponse> {
    const result = await read(table, conditions); // just use it directly

    if (!result.success || !Array.isArray(result.data)) {
      return { success: false, message: 'Query failed', data: null };
    }

    if (result.data.length === 0) {
      return { success: false, message: 'Record not found', data: null };
    }

    return {
      success: true,
      message: 'Record found',
      data: result.data[0]
    };
  }

  export async function findOrFail(table: string, key: string, value: unknown): Promise<unknown> {
    const result = await readOne(table, { [key]: value });

    if (!result.success || !result.data) {
      throw new Error('Record not found');
    }

    return result.data;
  }

  export async function readWith(table: string, conditions: Record<string, any> = {}, joins: JoinSpec[] = [], options: ReadOptions = {}): Promise<OrmResponse> {
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

            // Split and escape each part
            const [leftTable, leftField] = leftCol.split('.');
            const [rightTable, rightField] = rightCol.split('.');
            const safeLeftCol = `${validateAndEscapeIdentifier(leftTable, 'table name')}.${validateAndEscapeIdentifier(leftField, 'column name')}`;
            const safeRightCol = `${validateAndEscapeIdentifier(rightTable, 'table name')}.${validateAndEscapeIdentifier(rightField, 'column name')}`;

            return `${joinType} JOIN ${safeJoinTable} ON ${safeLeftCol} = ${safeRightCol}`;
        }).join(' ');

        // Validate and escape ORDER BY (handle both qualified and simple)
        let orderClause = '';
        if (options.orderBy) {
            if (validateQualifiedIdentifier(options.orderBy)) {
                // Qualified identifier (table.column)
                const [orderTable, orderField] = options.orderBy.split('.');
                const safeOrderBy = `${validateAndEscapeIdentifier(orderTable, 'table name')}.${validateAndEscapeIdentifier(orderField, 'column name')}`;
                orderClause = `ORDER BY ${safeOrderBy} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
            } else {
                // Simple identifier
                orderClause = `ORDER BY ${validateAndEscapeIdentifier(options.orderBy, 'order by column')} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
            }
        }

        // MySQL requires LIMIT before OFFSET; emit the max-row sentinel when an
        // offset is supplied without a limit. != null honors an explicit 0.
        const limit = options.limit != null ? Number.parseInt(String(options.limit), 10) : null;
        const offset = options.offset != null ? Number.parseInt(String(options.offset), 10) : null;
        const limitClause = limit != null ? `LIMIT ${limit}` : '';
        const offsetClause = offset != null
            ? (limit != null ? `OFFSET ${offset}` : `LIMIT 18446744073709551615 OFFSET ${offset}`)
            : '';

        const sql = `SELECT * FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

        const values = whereKeys.map(k => conditions[k]);

        const [rows] = await pool.execute(sql, values);

        return formatResponse(true, 'Data retrieved with join', rows);
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'readWith', { table }));
    }
}



export async function update(table: string, struct: Field[], payload: Record<string, any>, idKey: string = 'id'): Promise<OrmResponse> {
    // Updates are partial by nature (only provided columns are written), so
    // required fields that are absent from the payload must not fail validation.
    const errors = validatePayload(struct, payload, { partial: true });
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    try {
        // Validate and escape table name and idKey
        const safeTable = validateAndEscapeIdentifier(table, 'table name');
        const safeIdKey = validateAndEscapeIdentifier(idKey, 'id column name');

        // Validate and escape column names in SET clause
        const updates = struct
            .filter(f => payload[f.name] !== undefined && f.name !== idKey)
            .map(f => `${validateAndEscapeIdentifier(f.name, 'column name')} = ?`);
        const values = struct
            .filter(f => payload[f.name] !== undefined && f.name !== idKey)
            .map(f => payload[f.name]);

        // Nothing to SET (only the id key, or no matching columns) would produce
        // `UPDATE ... SET  WHERE id = ?`, a SQL parse error. Fail cleanly instead.
        if (updates.length === 0) {
            return formatResponse(false, 'No fields to update', []);
        }

        values.push(payload[idKey]);
        const sql = `UPDATE ${safeTable} SET ${updates.join(', ')} WHERE ${safeIdKey} = ?`;

        const [result] = await pool.execute(sql, values);
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

        const values: any[] = [idVal];
        const [result] = await pool.execute(sql, values);
        return formatResponse(true, 'Record deleted', result);
    } catch (error) {
        return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'remove', { table }));
    }
}
