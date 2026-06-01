import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import dotenv from 'dotenv';
import { validateAndEscapeIdentifier, sanitizeError } from './security.js';
import type { Field } from './validator.js';

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

// Standard envelope returned by every data operation.
export interface OrmResponse<T = unknown> {
    success: boolean;
    message: string;
    data: T;
}

function formatResponse(success: boolean, message: string, data: unknown = null): OrmResponse {
    return { success, message, data };
}

// Internal representation of an accumulated WHERE condition. `field` is used by
// single-column conditions; `fields` by the any/all/none multi-column variants.
type WhereType = 'basic' | 'in' | 'null' | 'any' | 'all' | 'none';
interface WhereClause {
    field?: string;
    fields?: string[];
    operator: string;
    value?: unknown;
    boolean: 'AND' | 'OR';
    type: WhereType;
}

interface JoinClause {
    type: 'INNER' | 'LEFT' | 'RIGHT';
    table: string;
    firstColumn: string;
    operator: string;
    secondColumn: string;
}

// Comparison operators permitted in WHERE / JOIN clauses. The operator occupies
// a SQL position that cannot be parameterized, so a caller-supplied operator
// must be validated against this fixed allowlist — otherwise a string such as
// "0 OR 1=1 OR age <" would be injected verbatim into the query.
const ALLOWED_OPERATORS = new Set(['=', '!=', '<>', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE']);

/**
 * Validate a caller-supplied comparison operator, returning its normalized
 * (uppercase) form. Throws immediately on anything outside the allowlist,
 * matching the fail-fast input validation already used by whereIn/whereAny.
 */
function assertOperator(operator: unknown): string {
    const op = String(operator).toUpperCase();
    if (!ALLOWED_OPERATORS.has(op)) {
        throw new Error(`Invalid operator: '${operator}'. Allowed: ${[...ALLOWED_OPERATORS].join(', ')}`);
    }
    return op;
}

export class QueryBuilder {
    table: string;
    struct: Field[] | null;
    private _wheres: WhereClause[];
    private _joins: JoinClause[];
    private _orderBy: string | null;
    private _direction: 'ASC' | 'DESC';
    private _limit: number | null;
    private _offset: number | null;
    private _select: string;

    constructor(table: string, struct: Field[] | null = null) {
        this.table = table;
        this.struct = struct;
        this._wheres = [];
        this._joins = [];
        this._orderBy = null;
        this._direction = 'ASC';
        this._limit = null;
        this._offset = null;
        this._select = '*';
    }

    /**
     * Add a WHERE clause. Supports where(field, value) and
     * where(field, operator, value).
     */
    where(field: string, operatorOrValue?: unknown, value: unknown = null): this {
        let operator: unknown = '=';
        let compareValue = operatorOrValue;

        // Handle both where(field, value) and where(field, operator, value)
        if (arguments.length === 3) {
            operator = operatorOrValue;
            compareValue = value;
        }

        this._wheres.push({
            field,
            operator: assertOperator(operator),
            value: compareValue,
            boolean: 'AND',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add an OR WHERE clause.
     */
    orWhere(field: string, operatorOrValue?: unknown, value: unknown = null): this {
        let operator: unknown = '=';
        let compareValue = operatorOrValue;

        if (arguments.length === 3) {
            operator = operatorOrValue;
            compareValue = value;
        }

        this._wheres.push({
            field,
            operator: assertOperator(operator),
            value: compareValue,
            boolean: 'OR',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add a WHERE NOT clause (field != value).
     */
    whereNot(field: string, value: unknown): this {
        this._wheres.push({
            field,
            operator: '!=',
            value,
            boolean: 'AND',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add a WHERE LIKE clause.
     */
    whereLike(field: string, pattern: string): this {
        this._wheres.push({
            field,
            operator: 'LIKE',
            value: pattern,
            boolean: 'AND',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add an OR WHERE LIKE clause.
     */
    orWhereLike(field: string, pattern: string): this {
        this._wheres.push({
            field,
            operator: 'LIKE',
            value: pattern,
            boolean: 'OR',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add a WHERE NOT LIKE clause.
     */
    whereNotLike(field: string, pattern: string): this {
        this._wheres.push({
            field,
            operator: 'NOT LIKE',
            value: pattern,
            boolean: 'AND',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add an OR WHERE NOT LIKE clause.
     */
    orWhereNotLike(field: string, pattern: string): this {
        this._wheres.push({
            field,
            operator: 'NOT LIKE',
            value: pattern,
            boolean: 'OR',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add an OR WHERE NOT clause.
     */
    orWhereNot(field: string, value: unknown): this {
        this._wheres.push({
            field,
            operator: '!=',
            value,
            boolean: 'OR',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add a WHERE clause checking if value matches ANY of the given columns.
     */
    whereAny(fields: string[], value: unknown): this {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('whereAny requires an array of field names');
        }

        this._wheres.push({
            fields,
            operator: '=',
            value,
            boolean: 'AND',
            type: 'any'
        });

        return this;
    }

    /**
     * Add a WHERE clause checking if value matches ALL of the given columns.
     */
    whereAll(fields: string[], value: unknown): this {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('whereAll requires an array of field names');
        }

        this._wheres.push({
            fields,
            operator: '=',
            value,
            boolean: 'AND',
            type: 'all'
        });

        return this;
    }

    /**
     * Add a WHERE clause checking if value matches NONE of the given columns.
     */
    whereNone(fields: string[], value: unknown): this {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('whereNone requires an array of field names');
        }

        this._wheres.push({
            fields,
            operator: '!=',
            value,
            boolean: 'AND',
            type: 'none'
        });

        return this;
    }

    /**
     * Add a WHERE IN clause.
     */
    whereIn(field: string, values: unknown[]): this {
        if (!Array.isArray(values)) {
            throw new Error('whereIn requires an array of values');
        }

        this._wheres.push({
            field,
            operator: 'IN',
            value: values,
            boolean: 'AND',
            type: 'in'
        });

        return this;
    }

    /**
     * Add an OR WHERE IN clause.
     */
    orWhereIn(field: string, values: unknown[]): this {
        if (!Array.isArray(values)) {
            throw new Error('orWhereIn requires an array of values');
        }

        this._wheres.push({
            field,
            operator: 'IN',
            value: values,
            boolean: 'OR',
            type: 'in'
        });

        return this;
    }

    /**
     * Add a WHERE NOT IN clause.
     */
    whereNotIn(field: string, values: unknown[]): this {
        if (!Array.isArray(values)) {
            throw new Error('whereNotIn requires an array of values');
        }

        this._wheres.push({
            field,
            operator: 'NOT IN',
            value: values,
            boolean: 'AND',
            type: 'in'
        });

        return this;
    }

    /**
     * Add a WHERE NULL clause.
     */
    whereNull(field: string): this {
        this._wheres.push({
            field,
            operator: 'IS NULL',
            value: null,
            boolean: 'AND',
            type: 'null'
        });

        return this;
    }

    /**
     * Add a WHERE NOT NULL clause.
     */
    whereNotNull(field: string): this {
        this._wheres.push({
            field,
            operator: 'IS NOT NULL',
            value: null,
            boolean: 'AND',
            type: 'null'
        });

        return this;
    }

    /**
     * Add an OR WHERE NULL clause.
     */
    orWhereNull(field: string): this {
        this._wheres.push({
            field,
            operator: 'IS NULL',
            value: null,
            boolean: 'OR',
            type: 'null'
        });

        return this;
    }

    /**
     * Add an OR WHERE NOT NULL clause.
     */
    orWhereNotNull(field: string): this {
        this._wheres.push({
            field,
            operator: 'IS NOT NULL',
            value: null,
            boolean: 'OR',
            type: 'null'
        });

        return this;
    }

    /**
     * Add an INNER JOIN clause. Supports innerJoin(table, col1, col2) and
     * innerJoin(table, col1, operator, col2). Columns may be qualified
     * (table.column).
     */
    innerJoin(table: string, firstColumn: string, operator: string = '=', secondColumn: string | null = null): this {
        // Handle both innerJoin(table, col1, col2) and innerJoin(table, col1, '=', col2)
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'INNER',
            table,
            firstColumn,
            operator: assertOperator(operator),
            secondColumn: secondColumn as string
        });

        return this;
    }

    /**
     * Add a LEFT JOIN clause.
     */
    leftJoin(table: string, firstColumn: string, operator: string = '=', secondColumn: string | null = null): this {
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'LEFT',
            table,
            firstColumn,
            operator: assertOperator(operator),
            secondColumn: secondColumn as string
        });

        return this;
    }

    /**
     * Add a RIGHT JOIN clause (outer join).
     */
    rightJoin(table: string, firstColumn: string, operator: string = '=', secondColumn: string | null = null): this {
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'RIGHT',
            table,
            firstColumn,
            operator: assertOperator(operator),
            secondColumn: secondColumn as string
        });

        return this;
    }

    /**
     * Alias for rightJoin.
     */
    outerJoin(table: string, firstColumn: string, operator: string = '=', secondColumn: string | null = null): this {
        // Preserve rightJoin's 3-arg shorthand. Forwarding a 4th (null) argument
        // would push arguments.length to 4, so rightJoin would read the second
        // column as the operator and reject it.
        return arguments.length === 3
            ? this.rightJoin(table, firstColumn, operator)
            : this.rightJoin(table, firstColumn, operator, secondColumn);
    }

    /**
     * Set ORDER BY clause.
     */
    orderBy(field: string, direction: string = 'ASC'): this {
        this._orderBy = field;
        this._direction = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return this;
    }

    /**
     * Set LIMIT clause.
     */
    limit(limit: number): this {
        this._limit = Number.parseInt(String(limit), 10);
        return this;
    }

    /**
     * Set OFFSET clause.
     */
    offset(offset: number): this {
        this._offset = Number.parseInt(String(offset), 10);
        return this;
    }

    /**
     * Build the WHERE clause SQL and bindings.
     */
    private _buildWhereClause(): { sql: string; bindings: any[] } {
        if (this._wheres.length === 0) {
            return { sql: '', bindings: [] };
        }

        const whereParts: string[] = [];
        // any[]: mysql2's execute() binds via its ExecuteValues type; values here
        // originate from caller payloads of unknown shape.
        const bindings: any[] = [];

        this._wheres.forEach((where, index) => {
            const boolean = index === 0 ? '' : ` ${where.boolean} `;

            if (where.type === 'null') {
                const safeField = validateAndEscapeIdentifier(where.field!, 'column name');
                whereParts.push(`${boolean}${safeField} ${where.operator}`);
            } else if (where.type === 'in') {
                const safeField = validateAndEscapeIdentifier(where.field!, 'column name');
                const inValues = where.value as unknown[];
                const placeholders = inValues.map(() => '?').join(', ');
                whereParts.push(`${boolean}${safeField} ${where.operator} (${placeholders})`);
                bindings.push(...inValues);
            } else if (where.type === 'any') {
                // WHERE (col1 = ? OR col2 = ? OR col3 = ?)
                const conditions = where.fields!.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' OR ');
                whereParts.push(`${boolean}(${conditions})`);
            } else if (where.type === 'all') {
                // WHERE (col1 = ? AND col2 = ? AND col3 = ?)
                const conditions = where.fields!.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' AND ');
                whereParts.push(`${boolean}(${conditions})`);
            } else if (where.type === 'none') {
                // WHERE (col1 != ? AND col2 != ? AND col3 != ?)
                const conditions = where.fields!.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' AND ');
                whereParts.push(`${boolean}(${conditions})`);
            } else {
                // Basic comparison
                const safeField = validateAndEscapeIdentifier(where.field!, 'column name');
                whereParts.push(`${boolean}${safeField} ${where.operator} ?`);
                bindings.push(where.value);
            }
        });

        return {
            sql: `WHERE ${whereParts.join('')}`,
            bindings
        };
    }

    /**
     * Build the JOIN clause SQL.
     */
    private _buildJoinClause(): string {
        if (this._joins.length === 0) {
            return '';
        }

        return this._joins.map(join => {
            const safeTable = validateAndEscapeIdentifier(join.table, 'join table name');

            // Handle qualified column names (table.column)
            const parseColumn = (col: string): string => {
                if (col.includes('.')) {
                    const [tbl, field] = col.split('.');
                    return `${validateAndEscapeIdentifier(tbl, 'table name')}.${validateAndEscapeIdentifier(field, 'column name')}`;
                }
                return validateAndEscapeIdentifier(col, 'column name');
            };

            const safeFirst = parseColumn(join.firstColumn);
            const safeSecond = parseColumn(join.secondColumn);

            return `${join.type} JOIN ${safeTable} ON ${safeFirst} ${join.operator} ${safeSecond}`;
        }).join(' ');
    }

    /**
     * Pluck a single column's values as an array.
     */
    async pluck(field: string): Promise<OrmResponse> {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const safeField = validateAndEscapeIdentifier(field, 'column name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const orderClause = this._orderBy
                ? `ORDER BY ${validateAndEscapeIdentifier(this._orderBy, 'order by column')} ${this._direction}`
                : '';

            // != null so an explicit limit/offset of 0 is honored. MySQL requires
            // LIMIT to precede OFFSET, so when an offset is given without a limit
            // we prepend the documented max-row sentinel (2^64 - 1).
            const limitClause = this._limit != null ? `LIMIT ${this._limit}` : '';
            const offsetClause = this._offset != null
                ? (this._limit != null ? `OFFSET ${this._offset}` : `LIMIT 18446744073709551615 OFFSET ${this._offset}`)
                : '';

            const sql = `SELECT ${safeField} FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

            const [rows] = await pool.execute(sql, bindings);

            // Extract just the values from the result rows
            const values = (rows as RowDataPacket[]).map(row => row[field]);

            return formatResponse(true, 'Data retrieved', values);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'pluck', { table: this.table }));
        }
    }

    /**
     * Execute query and return all results.
     */
    async get(): Promise<OrmResponse> {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const orderClause = this._orderBy
                ? `ORDER BY ${validateAndEscapeIdentifier(this._orderBy, 'order by column')} ${this._direction}`
                : '';

            // != null so an explicit limit/offset of 0 is honored. MySQL requires
            // LIMIT to precede OFFSET, so when an offset is given without a limit
            // we prepend the documented max-row sentinel (2^64 - 1).
            const limitClause = this._limit != null ? `LIMIT ${this._limit}` : '';
            const offsetClause = this._offset != null
                ? (this._limit != null ? `OFFSET ${this._offset}` : `LIMIT 18446744073709551615 OFFSET ${this._offset}`)
                : '';

            const sql = `SELECT ${this._select} FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

            const [rows] = await pool.execute(sql, bindings);
            return formatResponse(true, 'Data retrieved', rows);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'get', { table: this.table }));
        }
    }

    /**
     * Execute query and return first result.
     */
    async first(): Promise<OrmResponse> {
        this._limit = 1;
        const result = await this.get();

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

    /**
     * Get count of matching records.
     */
    async count(): Promise<OrmResponse> {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const sql = `SELECT COUNT(*) as count FROM ${safeTable} ${joinClause} ${whereClause}`.trim();

            const [rows] = await pool.execute(sql, bindings);
            return formatResponse(true, 'Count retrieved', (rows as RowDataPacket[])[0].count);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'count', { table: this.table }));
        }
    }

    /**
     * Get sum of a column.
     */
    async sum(field: string): Promise<OrmResponse> {
        return this._aggregate('SUM', field);
    }

    /**
     * Get average of a column.
     */
    async avg(field: string): Promise<OrmResponse> {
        return this._aggregate('AVG', field);
    }

    /**
     * Get maximum value of a column.
     */
    async max(field: string): Promise<OrmResponse> {
        return this._aggregate('MAX', field);
    }

    /**
     * Get minimum value of a column.
     */
    async min(field: string): Promise<OrmResponse> {
        return this._aggregate('MIN', field);
    }

    /**
     * Execute aggregate function.
     */
    private async _aggregate(func: string, field: string): Promise<OrmResponse> {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const safeField = validateAndEscapeIdentifier(field, 'column name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const sql = `SELECT ${func}(${safeField}) as result FROM ${safeTable} ${joinClause} ${whereClause}`.trim();

            const [rows] = await pool.execute(sql, bindings);

            // mysql2 returns DECIMAL aggregates (SUM/AVG) as strings to avoid
            // float precision loss. Coerce numeric-looking results to Number so
            // callers get numbers; leave non-numeric results (e.g. MAX of a date
            // or text column) and null untouched.
            const raw = (rows as RowDataPacket[])[0].result;
            const value = raw === null || Number.isNaN(Number(raw)) ? raw : Number(raw);

            return formatResponse(true, `${func} retrieved`, value);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, func.toLowerCase(), { table: this.table }));
        }
    }

    /**
     * Create a fresh query builder instance.
     */
    clone(): QueryBuilder {
        return new QueryBuilder(this.table, this.struct);
    }
}
