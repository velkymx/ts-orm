import { create, read, readOne, readWith, findOrFail, update, remove } from './orm.js';
import { QueryBuilder } from './QueryBuilder.js';

/**
 * Create a model wrapper for a table with its struct
 * Provides a clean API while maintaining backward compatibility
 *
 * @param {string} table - Table name
 * @param {Array} struct - Table structure definition
 * @param {Object} options - Additional options
 * @param {string} options.primaryKey - Primary key column name (default: 'id')
 * @returns {Object} Model object with helper methods
 *
 * @example
 * const User = model('users', userStruct);
 * const user = await User.find('123');
 * await User.create({ name: 'Alice' });
 * const active = await User.where('status', 'active').get();
 */
export function model(table, struct, options = {}) {
    const primaryKey = options.primaryKey || 'id';

    return {
        table,
        struct,
        primaryKey,

        /**
         * Create a new query builder instance
         * @returns {QueryBuilder}
         */
        query() {
            return new QueryBuilder(table, struct);
        },

        /**
         * Find a record by primary key
         * @param {*} id - Primary key value
         * @returns {Promise<Object>}
         */
        async find(id) {
            return readOne(table, { [primaryKey]: id });
        },

        /**
         * Find a record by primary key or throw error
         * @param {*} id - Primary key value
         * @returns {Promise<Object>}
         * @throws {Error} If record not found
         */
        async findOrFail(id) {
            return findOrFail(table, primaryKey, id);
        },

        /**
         * Start a WHERE query
         * @param {string|Object} fieldOrConditions - Field name or conditions object
         * @param {*} operatorOrValue - Operator or value
         * @param {*} value - Value (optional)
         * @returns {QueryBuilder}
         */
        where(fieldOrConditions, operatorOrValue, value) {
            const builder = new QueryBuilder(table, struct);

            // If first argument is an object, treat as key-value conditions
            if (typeof fieldOrConditions === 'object' && fieldOrConditions !== null) {
                Object.entries(fieldOrConditions).forEach(([field, val]) => {
                    builder.where(field, val);
                });
                return builder;
            }

            // Forward only the arguments actually received. QueryBuilder.where
            // uses arguments.length to distinguish where(field, value) from
            // where(field, operator, value); passing `value` as an explicit
            // third argument here (undefined in the 2-arg case) would make it
            // misread the value as the operator and emit invalid SQL.
            return arguments.length >= 3
                ? builder.where(fieldOrConditions, operatorOrValue, value)
                : builder.where(fieldOrConditions, operatorOrValue);
        },

        /**
         * Start a WHERE IN query
         * @param {string} field - Column name
         * @param {Array} values - Array of values
         * @returns {QueryBuilder}
         */
        whereIn(field, values) {
            return new QueryBuilder(table, struct).whereIn(field, values);
        },

        /**
         * Start a WHERE NULL query
         * @param {string} field - Column name
         * @returns {QueryBuilder}
         */
        whereNull(field) {
            return new QueryBuilder(table, struct).whereNull(field);
        },

        /**
         * Start a WHERE NOT NULL query
         * @param {string} field - Column name
         * @returns {QueryBuilder}
         */
        whereNotNull(field) {
            return new QueryBuilder(table, struct).whereNotNull(field);
        },

        /**
         * Get all records
         * @param {Object} conditions - Optional where conditions (simple key-value pairs)
         * @returns {Promise<Object>}
         */
        async all(conditions = {}) {
            return read(table, conditions);
        },

        /**
         * Get first record matching conditions
         * @param {Object} conditions - Where conditions (simple key-value pairs)
         * @returns {Promise<Object>}
         */
        async first(conditions = {}) {
            return readOne(table, conditions);
        },

        /**
         * Create a new record
         * @param {Object} payload - Record data
         * @returns {Promise<Object>}
         */
        async create(payload) {
            return create(table, struct, payload);
        },

        /**
         * Update a record
         * @param {Object} payload - Record data (must include primary key)
         * @param {string} idKey - Optional custom ID key (defaults to primaryKey)
         * @returns {Promise<Object>}
         */
        async update(payload, idKey = null) {
            return update(table, struct, payload, idKey || primaryKey);
        },

        /**
         * Delete a record by primary key
         * @param {*} id - Primary key value
         * @returns {Promise<Object>}
         */
        async delete(id) {
            return remove(table, primaryKey, id);
        },

        /**
         * Delete records matching conditions (uses custom ID key)
         * @param {string} idKey - Column name to match
         * @param {*} idValue - Value to match
         * @returns {Promise<Object>}
         */
        async deleteWhere(idKey, idValue) {
            return remove(table, idKey, idValue);
        },

        /**
         * Read with joins
         * @param {Object} conditions - Where conditions
         * @param {Array} joins - Join definitions
         * @param {Object} options - Query options (orderBy, limit, etc.)
         * @returns {Promise<Object>}
         */
        async readWith(conditions, joins, options = {}) {
            return readWith(table, conditions, joins, options);
        },

        /**
         * Get count of all records
         * @returns {Promise<Object>}
         */
        async count() {
            return new QueryBuilder(table, struct).count();
        },

        /**
         * Get sum of a column
         * @param {string} field - Column name
         * @returns {Promise<Object>}
         */
        async sum(field) {
            return new QueryBuilder(table, struct).sum(field);
        },

        /**
         * Get average of a column
         * @param {string} field - Column name
         * @returns {Promise<Object>}
         */
        async avg(field) {
            return new QueryBuilder(table, struct).avg(field);
        },

        /**
         * Get maximum value of a column
         * @param {string} field - Column name
         * @returns {Promise<Object>}
         */
        async max(field) {
            return new QueryBuilder(table, struct).max(field);
        },

        /**
         * Get minimum value of a column
         * @param {string} field - Column name
         * @returns {Promise<Object>}
         */
        async min(field) {
            return new QueryBuilder(table, struct).min(field);
        },

        /**
         * Set ORDER BY and return query builder
         * @param {string} field - Column name
         * @param {string} direction - 'ASC' or 'DESC'
         * @returns {QueryBuilder}
         */
        orderBy(field, direction = 'ASC') {
            return new QueryBuilder(table, struct).orderBy(field, direction);
        },

        /**
         * Set LIMIT and return query builder
         * @param {number} limit - Number of records
         * @returns {QueryBuilder}
         */
        limit(limit) {
            return new QueryBuilder(table, struct).limit(limit);
        },

        /**
         * Set OFFSET and return query builder
         * @param {number} offset - Number of records to skip
         * @returns {QueryBuilder}
         */
        offset(offset) {
            return new QueryBuilder(table, struct).offset(offset);
        },

        /**
         * Pluck a single column's values as an array (for chaining, use query().where(...).pluck())
         * @param {string} field - Column name to pluck
         * @param {Object} conditions - Optional where conditions
         * @returns {Promise<Object>}
         */
        async pluck(field, conditions = {}) {
            const builder = new QueryBuilder(table, struct);

            // Apply simple conditions if provided
            if (Object.keys(conditions).length > 0) {
                Object.entries(conditions).forEach(([key, value]) => {
                    builder.where(key, value);
                });
            }

            return builder.pluck(field);
        }
    };
}
