import { create, read, readOne, readWith, findOrFail, update, remove } from './orm.js';
import type { JoinSpec, ReadOptions } from './orm.js';
import { QueryBuilder } from './QueryBuilder.js';
import type { Field } from './validator.js';

/**
 * Create a model wrapper for a table with its struct.
 * Provides a clean API while maintaining backward compatibility.
 *
 * @example
 * const User = model('users', userStruct);
 * const user = await User.find('123');
 * await User.create({ name: 'Alice' });
 * const active = await User.where('status', 'active').get();
 */
export function model<T = Record<string, unknown>>(table: string, struct: Field[], options: { primaryKey?: string } = {}) {
    const primaryKey = options.primaryKey || 'id';

    return {
        table,
        struct,
        primaryKey,

        /**
         * Create a new query builder instance.
         */
        query(): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct);
        },

        /**
         * Find a record by primary key.
         */
        async find(id: unknown) {
            return readOne<T>(table, { [primaryKey]: id });
        },

        /**
         * Find a record by primary key. Returns the standard {success,...}
         * envelope (success:false with 'Record not found' when absent).
         */
        async findOrFail(id: unknown) {
            return findOrFail<T>(table, primaryKey, id);
        },

        /**
         * Start a WHERE query. Accepts where(field, value),
         * where(field, operator, value), or a conditions object.
         */
        where(fieldOrConditions: string | Record<string, unknown>, operatorOrValue?: unknown, value?: unknown): QueryBuilder<T> {
            const builder = new QueryBuilder<T>(table, struct);

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
         * Start a WHERE IN query.
         */
        whereIn(field: string, values: unknown[]): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).whereIn(field, values);
        },

        /**
         * Start a WHERE NULL query.
         */
        whereNull(field: string): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).whereNull(field);
        },

        /**
         * Start a WHERE NOT NULL query.
         */
        whereNotNull(field: string): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).whereNotNull(field);
        },

        /**
         * Get all records.
         */
        async all(conditions: Record<string, unknown> = {}) {
            return read<T>(table, conditions);
        },

        /**
         * Get first record matching conditions.
         */
        async first(conditions: Record<string, unknown> = {}) {
            return readOne<T>(table, conditions);
        },

        /**
         * Create a new record.
         */
        async create(payload: Record<string, unknown>) {
            return create(table, struct, payload);
        },

        /**
         * Update a record (payload must include the primary key).
         */
        async update(payload: Record<string, unknown>, idKey: string | null = null) {
            return update(table, struct, payload, idKey || primaryKey);
        },

        /**
         * Delete a record by primary key.
         */
        async delete(id: unknown) {
            return remove(table, primaryKey, id);
        },

        /**
         * Delete records matching a custom key.
         */
        async deleteWhere(idKey: string, idValue: unknown) {
            return remove(table, idKey, idValue);
        },

        /**
         * Read with joins.
         */
        async readWith(conditions: Record<string, unknown>, joins: JoinSpec[], options: ReadOptions = {}) {
            return readWith(table, conditions, joins, options);
        },

        /**
         * Get count of all records.
         */
        async count() {
            return new QueryBuilder<T>(table, struct).count();
        },

        /**
         * Get sum of a column.
         */
        async sum(field: string) {
            return new QueryBuilder<T>(table, struct).sum(field);
        },

        /**
         * Get average of a column.
         */
        async avg(field: string) {
            return new QueryBuilder<T>(table, struct).avg(field);
        },

        /**
         * Get maximum value of a column.
         */
        async max(field: string) {
            return new QueryBuilder<T>(table, struct).max(field);
        },

        /**
         * Get minimum value of a column.
         */
        async min(field: string) {
            return new QueryBuilder<T>(table, struct).min(field);
        },

        /**
         * Set ORDER BY and return query builder.
         */
        orderBy(field: string, direction: string = 'ASC'): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).orderBy(field, direction);
        },

        /**
         * Set LIMIT and return query builder.
         */
        limit(limit: number): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).limit(limit);
        },

        /**
         * Set OFFSET and return query builder.
         */
        offset(offset: number): QueryBuilder<T> {
            return new QueryBuilder<T>(table, struct).offset(offset);
        },

        /**
         * Pluck a single column's values as an array (for chaining, use
         * query().where(...).pluck()).
         */
        async pluck(field: string, conditions: Record<string, unknown> = {}) {
            const builder = new QueryBuilder<T>(table, struct);

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
