import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { validateAndEscapeIdentifier, sanitizeError } from './security.js';

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

function formatResponse(success, message, data = null) {
    return { success, message, data };
}

export class QueryBuilder {
    constructor(table, struct = null) {
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
     * Add a WHERE clause
     * @param {string} field - Column name
     * @param {string|*} operatorOrValue - Operator ('=', '>', '<', '>=', '<=', '!=', 'LIKE') or value if 2 args
     * @param {*} value - Value to compare (optional if operator is omitted)
     * @returns {QueryBuilder}
     */
    where(field, operatorOrValue, value = null) {
        let operator = '=';
        let compareValue = operatorOrValue;

        // Handle both where(field, value) and where(field, operator, value)
        if (arguments.length === 3) {
            operator = operatorOrValue;
            compareValue = value;
        }

        this._wheres.push({
            field,
            operator: operator.toUpperCase(),
            value: compareValue,
            boolean: 'AND',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add an OR WHERE clause
     * @param {string} field
     * @param {string|*} operatorOrValue
     * @param {*} value
     * @returns {QueryBuilder}
     */
    orWhere(field, operatorOrValue, value = null) {
        let operator = '=';
        let compareValue = operatorOrValue;

        if (arguments.length === 3) {
            operator = operatorOrValue;
            compareValue = value;
        }

        this._wheres.push({
            field,
            operator: operator.toUpperCase(),
            value: compareValue,
            boolean: 'OR',
            type: 'basic'
        });

        return this;
    }

    /**
     * Add a WHERE NOT clause (field != value)
     * @param {string} field
     * @param {*} value
     * @returns {QueryBuilder}
     */
    whereNot(field, value) {
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
     * Add a WHERE LIKE clause
     * @param {string} field - Column name
     * @param {string} pattern - LIKE pattern (use % for wildcards)
     * @returns {QueryBuilder}
     */
    whereLike(field, pattern) {
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
     * Add an OR WHERE LIKE clause
     * @param {string} field - Column name
     * @param {string} pattern - LIKE pattern (use % for wildcards)
     * @returns {QueryBuilder}
     */
    orWhereLike(field, pattern) {
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
     * Add a WHERE NOT LIKE clause
     * @param {string} field - Column name
     * @param {string} pattern - LIKE pattern (use % for wildcards)
     * @returns {QueryBuilder}
     */
    whereNotLike(field, pattern) {
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
     * Add an OR WHERE NOT LIKE clause
     * @param {string} field - Column name
     * @param {string} pattern - LIKE pattern (use % for wildcards)
     * @returns {QueryBuilder}
     */
    orWhereNotLike(field, pattern) {
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
     * Add an OR WHERE NOT clause
     * @param {string} field
     * @param {*} value
     * @returns {QueryBuilder}
     */
    orWhereNot(field, value) {
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
     * Add a WHERE clause checking if value matches ANY of the given columns
     * @param {Array<string>} fields - Array of column names
     * @param {*} value - Value to match against
     * @returns {QueryBuilder}
     */
    whereAny(fields, value) {
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
     * Add a WHERE clause checking if value matches ALL of the given columns
     * @param {Array<string>} fields - Array of column names
     * @param {*} value - Value to match against
     * @returns {QueryBuilder}
     */
    whereAll(fields, value) {
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
     * Add a WHERE clause checking if value matches NONE of the given columns
     * @param {Array<string>} fields - Array of column names
     * @param {*} value - Value to match against
     * @returns {QueryBuilder}
     */
    whereNone(fields, value) {
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
     * Add a WHERE IN clause
     * @param {string} field
     * @param {Array} values
     * @returns {QueryBuilder}
     */
    whereIn(field, values) {
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
     * Add an OR WHERE IN clause
     * @param {string} field
     * @param {Array} values
     * @returns {QueryBuilder}
     */
    orWhereIn(field, values) {
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
     * Add a WHERE NOT IN clause
     * @param {string} field
     * @param {Array} values
     * @returns {QueryBuilder}
     */
    whereNotIn(field, values) {
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
     * Add a WHERE NULL clause
     * @param {string} field
     * @returns {QueryBuilder}
     */
    whereNull(field) {
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
     * Add a WHERE NOT NULL clause
     * @param {string} field
     * @returns {QueryBuilder}
     */
    whereNotNull(field) {
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
     * Add an OR WHERE NULL clause
     * @param {string} field
     * @returns {QueryBuilder}
     */
    orWhereNull(field) {
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
     * Add an OR WHERE NOT NULL clause
     * @param {string} field
     * @returns {QueryBuilder}
     */
    orWhereNotNull(field) {
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
     * Add an INNER JOIN clause
     * @param {string} table - Table to join
     * @param {string} firstColumn - First column in join condition (can be qualified: table.column)
     * @param {string} operator - Comparison operator (default '=')
     * @param {string} secondColumn - Second column in join condition (can be qualified: table.column)
     * @returns {QueryBuilder}
     */
    innerJoin(table, firstColumn, operator = '=', secondColumn = null) {
        // Handle both innerJoin(table, col1, col2) and innerJoin(table, col1, '=', col2)
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'INNER',
            table,
            firstColumn,
            operator,
            secondColumn
        });

        return this;
    }

    /**
     * Add a LEFT JOIN clause
     * @param {string} table - Table to join
     * @param {string} firstColumn - First column in join condition
     * @param {string} operator - Comparison operator (default '=')
     * @param {string} secondColumn - Second column in join condition
     * @returns {QueryBuilder}
     */
    leftJoin(table, firstColumn, operator = '=', secondColumn = null) {
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'LEFT',
            table,
            firstColumn,
            operator,
            secondColumn
        });

        return this;
    }

    /**
     * Add a RIGHT JOIN clause (outer join)
     * @param {string} table - Table to join
     * @param {string} firstColumn - First column in join condition
     * @param {string} operator - Comparison operator (default '=')
     * @param {string} secondColumn - Second column in join condition
     * @returns {QueryBuilder}
     */
    rightJoin(table, firstColumn, operator = '=', secondColumn = null) {
        if (arguments.length === 3) {
            secondColumn = operator;
            operator = '=';
        }

        this._joins.push({
            type: 'RIGHT',
            table,
            firstColumn,
            operator,
            secondColumn
        });

        return this;
    }

    /**
     * Alias for rightJoin
     * @param {string} table
     * @param {string} firstColumn
     * @param {string} operator
     * @param {string} secondColumn
     * @returns {QueryBuilder}
     */
    outerJoin(table, firstColumn, operator = '=', secondColumn = null) {
        return this.rightJoin(table, firstColumn, operator, secondColumn);
    }

    /**
     * Set ORDER BY clause
     * @param {string} field
     * @param {string} direction - 'ASC' or 'DESC'
     * @returns {QueryBuilder}
     */
    orderBy(field, direction = 'ASC') {
        this._orderBy = field;
        this._direction = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return this;
    }

    /**
     * Set LIMIT clause
     * @param {number} limit
     * @returns {QueryBuilder}
     */
    limit(limit) {
        this._limit = Number.parseInt(limit, 10);
        return this;
    }

    /**
     * Set OFFSET clause
     * @param {number} offset
     * @returns {QueryBuilder}
     */
    offset(offset) {
        this._offset = Number.parseInt(offset, 10);
        return this;
    }

    /**
     * Build the WHERE clause SQL and bindings
     * @returns {{ sql: string, bindings: Array }}
     * @private
     */
    _buildWhereClause() {
        if (this._wheres.length === 0) {
            return { sql: '', bindings: [] };
        }

        const whereParts = [];
        const bindings = [];

        this._wheres.forEach((where, index) => {
            const boolean = index === 0 ? '' : ` ${where.boolean} `;

            if (where.type === 'null') {
                const safeField = validateAndEscapeIdentifier(where.field, 'column name');
                whereParts.push(`${boolean}${safeField} ${where.operator}`);
            } else if (where.type === 'in') {
                const safeField = validateAndEscapeIdentifier(where.field, 'column name');
                const placeholders = where.value.map(() => '?').join(', ');
                whereParts.push(`${boolean}${safeField} ${where.operator} (${placeholders})`);
                bindings.push(...where.value);
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
     * Build the JOIN clause SQL
     * @returns {string}
     * @private
     */
    _buildJoinClause() {
        if (this._joins.length === 0) {
            return '';
        }

        return this._joins.map(join => {
            const safeTable = validateAndEscapeIdentifier(join.table, 'join table name');

            // Handle qualified column names (table.column)
            const parseColumn = (col) => {
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
     * Pluck a single column's values as an array
     * @param {string} field - Column name to pluck
     * @returns {Promise<Object>}
     */
    async pluck(field) {
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
            const values = rows.map(row => row[field]);

            return formatResponse(true, 'Data retrieved', values);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error, 'pluck', { table: this.table }));
        }
    }

    /**
     * Execute query and return all results
     * @returns {Promise<Object>}
     */
    async get() {
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
            return formatResponse(false, 'Database operation failed', sanitizeError(error, 'get', { table: this.table }));
        }
    }

    /**
     * Execute query and return first result
     * @returns {Promise<Object>}
     */
    async first() {
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
     * Get count of matching records
     * @returns {Promise<Object>}
     */
    async count() {
        try {
            const safeTable = validateAndEscapeIdentifier(this.table, 'table name');
            const joinClause = this._buildJoinClause();
            const { sql: whereClause, bindings } = this._buildWhereClause();

            const sql = `SELECT COUNT(*) as count FROM ${safeTable} ${joinClause} ${whereClause}`.trim();

            const [rows] = await pool.execute(sql, bindings);
            return formatResponse(true, 'Count retrieved', rows[0].count);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error, 'count', { table: this.table }));
        }
    }

    /**
     * Get sum of a column
     * @param {string} field
     * @returns {Promise<Object>}
     */
    async sum(field) {
        return this._aggregate('SUM', field);
    }

    /**
     * Get average of a column
     * @param {string} field
     * @returns {Promise<Object>}
     */
    async avg(field) {
        return this._aggregate('AVG', field);
    }

    /**
     * Get maximum value of a column
     * @param {string} field
     * @returns {Promise<Object>}
     */
    async max(field) {
        return this._aggregate('MAX', field);
    }

    /**
     * Get minimum value of a column
     * @param {string} field
     * @returns {Promise<Object>}
     */
    async min(field) {
        return this._aggregate('MIN', field);
    }

    /**
     * Execute aggregate function
     * @param {string} func - Aggregate function name
     * @param {string} field - Column name
     * @returns {Promise<Object>}
     * @private
     */
    async _aggregate(func, field) {
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
            const raw = rows[0].result;
            const value = raw === null || Number.isNaN(Number(raw)) ? raw : Number(raw);

            return formatResponse(true, `${func} retrieved`, value);
        } catch (error) {
            return formatResponse(false, 'Database operation failed', sanitizeError(error, func.toLowerCase(), { table: this.table }));
        }
    }

    /**
     * Create a fresh query builder instance
     * @returns {QueryBuilder}
     */
    clone() {
        return new QueryBuilder(this.table, this.struct);
    }
}
