/**
 * CRUD operations over a struct. SQL is assembled from the struct's own field
 * definitions and rendered through the active dialect, so the same code targets
 * every supported engine. Values are always bound, never interpolated.
 */

import type { Dialect } from './dialect.js';
import { safeIdentifier } from './identifiers.js';
import type { BindValue, Driver } from './driver.js';
import type { Fields, InsertOf, RowOf, Struct, UpdateOf } from './struct.js';
import { validatePayload } from './validation.js';
import { ok, fail, type Result } from './result.js';

/** A rendered statement: parameterized SQL plus its positional bind values. */
export interface BuiltStatement {
  readonly sql: string;
  readonly params: readonly BindValue[];
}

/** The primary key column: the auto_increment field, else the first field, else id. */
function primaryKey(fields: Fields): string {
  for (const name of Object.keys(fields)) {
    if (fields[name]!.default === 'auto_increment') return name;
  }
  return Object.keys(fields)[0] ?? 'id';
}

/**
 * Build an INSERT. Columns absent from the payload are omitted so the database
 * applies their defaults; auto_increment columns are never written. The new-row
 * id is requested using the dialect's strategy.
 */
export function buildInsert<Table extends string, F extends Fields>(
  dialect: Dialect,
  struct: Struct<Table, F>,
  payload: Record<string, unknown>,
): BuiltStatement {
  const names = Object.keys(struct.fields).filter(
    (name) => payload[name] !== undefined && struct.fields[name]!.default !== 'auto_increment',
  );

  const table = safeIdentifier(struct.table, dialect, 'table name');
  const columns = names.map((name) => safeIdentifier(name, dialect, 'column name')).join(', ');
  const placeholders = names.map((_, i) => dialect.placeholder(i + 1)).join(', ');
  const params = names.map((name) => payload[name] as BindValue);

  const output =
    dialect.insertIdStrategy === 'output'
      ? ` OUTPUT INSERTED.${safeIdentifier(primaryKey(struct.fields), dialect, 'column name')}`
      : '';

  let sql = `INSERT INTO ${table} (${columns})${output} VALUES (${placeholders})`;

  if (dialect.insertIdStrategy === 'returning') {
    sql += ` RETURNING ${safeIdentifier(primaryKey(struct.fields), dialect, 'column name')}`;
  }

  return { sql, params };
}

/** Options for a read: ordering and row-window bounds. */
export interface ReadOptions {
  readonly orderBy?: string;
  readonly direction?: 'asc' | 'desc';
  readonly limit?: number;
  readonly offset?: number;
}

/** Coerce to a non-negative integer, or undefined when not usable. */
function toCount(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Build a SELECT with AND-equality conditions and optional order/limit/offset. */
export function buildSelect<Table extends string, F extends Fields>(
  dialect: Dialect,
  struct: Struct<Table, F>,
  conditions: Record<string, unknown>,
  options: ReadOptions,
): BuiltStatement {
  const table = safeIdentifier(struct.table, dialect, 'table name');
  const keys = Object.keys(conditions);
  const params = keys.map((key) => conditions[key] as BindValue);

  const where = keys.length
    ? ` WHERE ${keys
        .map((key, i) => `${safeIdentifier(key, dialect, 'column name')} = ${dialect.placeholder(i + 1)}`)
        .join(' AND ')}`
    : '';

  let orderClause = options.orderBy
    ? `ORDER BY ${safeIdentifier(options.orderBy, dialect, 'order by column')} ${
        options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      }`
    : '';

  const limitClause = dialect.limitOffset(toCount(options.limit), toCount(options.offset));

  // SQL Server's OFFSET/FETCH requires an ORDER BY; supply a stable no-op one.
  if (dialect.name === 'mssql' && limitClause && !orderClause) {
    orderClause = 'ORDER BY (SELECT NULL)';
  }

  let sql = `SELECT * FROM ${table}${where}`;
  if (orderClause) sql += ` ${orderClause}`;
  if (limitClause) sql += ` ${limitClause}`;

  return { sql, params };
}

/** Read rows matching equality conditions. */
export async function read<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
  conditions: Partial<RowOf<F>> = {},
  options: ReadOptions = {},
): Promise<Result<RowOf<F>[]>> {
  try {
    const { sql, params } = buildSelect(driver.dialect, struct, conditions, options);
    const rows = await driver.query<RowOf<F>>(sql, params);
    return ok(rows, 'Data retrieved');
  } catch (error) {
    return fail('Database operation failed', [(error as Error).message]);
  }
}

/** Insert a record, returning the new row id. Validates the payload first. */
export async function create<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
  payload: InsertOf<F>,
): Promise<Result<{ id: number | string | undefined }>> {
  const data = payload as Record<string, unknown>;
  const errors = validatePayload(struct.fields, data, { skipAutoIncrement: true });
  if (errors.length > 0) {
    return fail('Validation failed', errors.map((e) => e.message));
  }

  try {
    const { sql, params } = buildInsert(driver.dialect, struct, data);
    const result = await driver.execute(sql, params);
    return ok({ id: result.insertId }, 'Record created');
  } catch (error) {
    return fail('Database operation failed', [(error as Error).message]);
  }
}

/** Column names (excluding the id) that carry a value to write. */
function updatableColumns(
  fields: Fields,
  payload: Record<string, unknown>,
  idKey: string,
): string[] {
  return Object.keys(fields).filter(
    (name) => name !== idKey && payload[name] !== undefined,
  );
}

/** Build an UPDATE that sets the supplied columns and filters on the id. */
export function buildUpdate<Table extends string, F extends Fields>(
  dialect: Dialect,
  struct: Struct<Table, F>,
  payload: Record<string, unknown>,
  idKey: string,
): BuiltStatement {
  const names = updatableColumns(struct.fields, payload, idKey);
  const assignments = names
    .map((name, i) => `${safeIdentifier(name, dialect, 'column name')} = ${dialect.placeholder(i + 1)}`)
    .join(', ');
  const table = safeIdentifier(struct.table, dialect, 'table name');
  const idColumn = safeIdentifier(idKey, dialect, 'id column name');
  const sql = `UPDATE ${table} SET ${assignments} WHERE ${idColumn} = ${dialect.placeholder(names.length + 1)}`;
  const params = [...names.map((name) => payload[name] as BindValue), payload[idKey] as BindValue];
  return { sql, params };
}

/** Build a DELETE that filters on the id column. */
export function buildDelete<Table extends string, F extends Fields>(
  dialect: Dialect,
  struct: Struct<Table, F>,
  idKey: string,
): string {
  const table = safeIdentifier(struct.table, dialect, 'table name');
  const idColumn = safeIdentifier(idKey, dialect, 'id column name');
  return `DELETE FROM ${table} WHERE ${idColumn} = ${dialect.placeholder(1)}`;
}

/** Update a record by id, writing only the columns present in the payload. */
export async function update<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
  payload: UpdateOf<F>,
  idKey: keyof F & string = 'id' as keyof F & string,
): Promise<Result<{ affectedRows: number }>> {
  const data = payload as Record<string, unknown>;
  const errors = validatePayload(struct.fields, data, { partial: true });
  if (errors.length > 0) {
    return fail('Validation failed', errors.map((e) => e.message));
  }
  if (data[idKey] === undefined || data[idKey] === null) {
    return fail('id value is required');
  }
  if (updatableColumns(struct.fields, data, idKey).length === 0) {
    return fail('No fields to update');
  }

  try {
    const { sql, params } = buildUpdate(driver.dialect, struct, data, idKey);
    const result = await driver.execute(sql, params);
    return ok({ affectedRows: result.affectedRows }, 'Record updated');
  } catch (error) {
    return fail('Database operation failed', [(error as Error).message]);
  }
}

/** Delete a record by its id column value. */
export async function remove<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
  idKey: keyof F & string,
  idValue: BindValue,
): Promise<Result<{ affectedRows: number }>> {
  if (idValue === undefined || idValue === null) {
    return fail('id value is required');
  }

  try {
    const sql = buildDelete(driver.dialect, struct, idKey);
    const result = await driver.execute(sql, [idValue]);
    return ok({ affectedRows: result.affectedRows }, 'Record deleted');
  } catch (error) {
    return fail('Database operation failed', [(error as Error).message]);
  }
}
