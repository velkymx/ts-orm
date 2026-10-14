/**
 * CRUD operations over a struct. SQL is assembled from the struct's own field
 * definitions and rendered through the active dialect, so the same code targets
 * every supported engine. Values are always bound, never interpolated.
 */

import type { Dialect } from './dialect.js';
import { safeIdentifier } from './identifiers.js';
import type { BindValue, Driver } from './driver.js';
import type { Fields, InsertOf, Struct } from './struct.js';
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
