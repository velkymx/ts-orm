import type { RowDataPacket } from 'mysql2';
import { runQuery, formatResponse, firstRow, limitOffsetClause } from './db.js';
import { validateAndEscapeIdentifier, sanitizeError } from './security.js';
import { castReadRows } from './casts.js';
import type { Field } from './validator.js';

// Standard envelope returned by every data operation.
export interface OrmResponse<T = unknown> {
    success: boolean;
    message: string;
    data: T;
}

// Accumulated WHERE conditions, as a discriminated union on `type` so each
// variant exposes exactly the fields it uses (no non-null assertions/casts).
type WhereBoolean = 'AND' | 'OR';
interface BasicWhere { type: 'basic'; field: string; operator: string; value: unknown; boolean: WhereBoolean; }
interface InWhere { type: 'in'; field: string; operator: string; value: unknown[]; boolean: WhereBoolean; }
interface NullWhere { type: 'null'; field: string; operator: string; boolean: WhereBoolean; }
interface AnyWhere { type: 'any'; fields: string[]; operator: string; value: unknown; boolean: WhereBoolean; }
interface AllWhere { type: 'all'; fields: string[]; operator: string; value: unknown; boolean: WhereBoolean; }
interface NoneWhere { type: 'none'; fields: string[]; operator: string; value: unknown; boolean: WhereBoolean; }
type WhereClause = BasicWhere | InWhere | NullWhere | AnyWhere | AllWhere | NoneWhere;

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

export class QueryBuilder<T = Record<string, unknown>> {
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
     * Restrict the selected columns. Each column is validated + escaped at call
     * time (it sits in a non-parameterizable SQL position); no args resets to *.
     */
    select(...fields: string[]): this {
        this._select = fields.length === 0
            ? '*'
            : fields.map(f => validateAndEscapeIdentifier(f, 'column name')).join(', ');
        return this;
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
    private _buildWhereClause(): { sql: string; bindings: unknown[] } {
        if (this._wheres.length === 0) {
            return { sql: '', bindings: [] };
        }

        const whereParts: string[] = [];
        // unknown[]: values originate from caller payloads. They are cast to
        // mysql2's ExecuteValues only inside runQuery (the single execute path).
        const bindings: unknown[] = [];

        this._wheres.forEach((where, index) => {
            const boolean = index === 0 ? '' : ` ${where.boolean} `;

            if (where.type === 'null') {
                const safeField = validateAndEscapeIdentifier(where.field, 'column name');
                whereParts.push(`${boolean}${safeField} ${where.operator}`);
            } else if (where.type === 'in') {
                // Validate the column even on the empty path so an injected field
                // name is still rejected.
                const safeField = validateAndEscapeIdentifier(where.field, 'column name');
                const inValues = where.value;
                if (inValues.length === 0) {
                    // `col IN ()` / `col NOT IN ()` is a MySQL syntax error. An
                    // empty IN matches nothing (0=1); an empty NOT IN matches
                    // everything (1=1). No bindings needed.
                    whereParts.push(`${boolean}${where.operator === 'NOT IN' ? '1=1' : '0=1'}`);
                } else {
                    const placeholders = inValues.map(() => '?').join(', ');
                    whereParts.push(`${boolean}${safeField} ${where.operator} (${placeholders})`);
                    bindings.push(...inValues);
                }
            } else if (where.type === 'any') {
                // WHERE (col1 = ? OR col2 = ? OR col3 = ?)
                const conditions = where.fields.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' OR ');
                whereParts.push(`${boolean}(${conditions})`);
            } else if (where.type === 'all') {
                // WHERE (col1 = ? AND col2 = ? AND col3 = ?)
                const conditions = where.fields.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' AND ');
                whereParts.push(`${boolean}(${conditions})`);
            } else if (where.type === 'none') {
                // WHERE (col1 != ? AND col2 != ? AND col3 != ?)
                const conditions = where.fields.map(field => {
                    const safeField = validateAndEscapeIdentifier(field, 'column name');
                    bindings.push(where.value);
                    return `${safeField} ${where.operator} ?`;
                }).join(' AND ');
                whereParts.push(`${boolean}(${conditions})`);
            } else {
                // Basic comparison
                const safeField = validateAndEscapeIdentifier(where.field, 'column name');
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
                    // includes('.') guarantees both parts; `?? ''` only satisfies
                    // the type checker (an empty part is rejected on escape).
                    const [tbl, field] = col.split('.');
                    return `${validateAndEscapeIdentifier(tbl ?? '', 'table name')}.${validateAndEscapeIdentifier(field ?? '', 'column name')}`;
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

            const limitOffset = limitOffsetClause(this._limit, this._offset);

            const sql = `SELECT ${safeField} FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitOffset}`.trim();

            const [rows] = await runQuery(sql, bindings);

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
    async get(): Promise<OrmResponse<T[]>> {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const orderClause = this._orderBy
                ? `ORDER BY ${validateAndEscapeIdentifier(this._orderBy, 'order by column')} ${this._direction}`
                : '';

            const limitOffset = limitOffsetClause(this._limit, this._offset);

            const sql = `SELECT ${this._select} FROM ${safeTable} ${joinClause} ${whereClause} ${orderClause} ${limitOffset}`.trim();

            const [rows] = await runQuery(sql, bindings);
            // Cast DB values to JS (boolean/json) using the struct, then return.
            // Rows are typed as T[] by the caller's generic; the envelope is
            // loosely typed on the failure branch (success path is sound).
            return formatResponse(true, 'Data retrieved', castReadRows(rows, this.struct)) as OrmResponse<T[]>;
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, 'get', { table: this.table })) as OrmResponse<T[]>;
        }
    }

    /**
     * Execute query and return first result.
     */
    async first(): Promise<OrmResponse<T>> {
        // first() returns a single record, so it always caps the query at one
        // row — any previously set .limit() is intentionally overridden.
        this._limit = 1;
        return firstRow(await this.get()) as OrmResponse<T>;
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

            const [rows] = await runQuery(sql, bindings);
            // COUNT(*) always yields exactly one row; default to 0 to satisfy the
            // type checker if the driver ever returns an empty set.
            return formatResponse(true, 'Count retrieved', (rows as RowDataPacket[])[0]?.count ?? 0);
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

            const [rows] = await runQuery(sql, bindings);

            // mysql2 returns DECIMAL aggregates (SUM/AVG) as strings to avoid
            // float precision loss. Coerce numeric-looking results to Number so
            // callers get numbers; leave non-numeric results (e.g. MAX of a date
            // or text column) and null untouched.
            // An aggregate always yields one row; `?? null` covers the empty case.
            const raw = (rows as RowDataPacket[])[0]?.result ?? null;
            const value = raw === null || Number.isNaN(Number(raw)) ? raw : Number(raw);

            return formatResponse(true, `${func} retrieved`, value);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error as Error, func.toLowerCase(), { table: this.table }));
        }
    }

    /**
     * Create a fresh query builder instance.
     */
    clone(): QueryBuilder<T> {
        return new QueryBuilder<T>(this.table, this.struct);
    }
}
