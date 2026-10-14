/**
 * Load-and-go facade mirroring the v1 API: plain table names plus named
 * field arrays, no driver or struct bootstrap. Calls run on the default
 * MySQL pool (resolved from the environment with dotenv autoload), with
 * an optional trailing driver for tests and other engines. Field arrays
 * fold into structs internally; reads that need no field metadata use a
 * minimal struct since only the table name shapes their SQL. Validation
 * semantics match v1 exactly: required rejects only undefined and null.
 */

import {
  create as createRow,
  findOrFail as findOrFailRow,
  read as readRows,
  readOne as readOneRow,
  readWith as readWithRows,
  remove as removeRow,
  update as updateRow,
} from './crud.js';
import type { JoinSpec, ReadOptions } from './crud.js';
import type { BindValue, Driver } from './driver.js';
import { createMysqlDriver } from './drivers/mysql.js';
import { defineStruct, type Fields, type FieldType, type RowOf } from './struct.js';

/** One v1-shaped field: its column name plus the struct definition. */
export interface NamedFieldDef {
  readonly name: string;
  readonly type: FieldType;
  readonly required?: boolean;
  readonly length?: number | null;
  readonly default?: string | null;
  readonly enum?: readonly string[];
}

/** Condition and payload values expressible through the facade. */
export type SimpleValue = string | number | boolean | undefined;

/** Equality conditions by column for facade reads. */
export type SimpleConditions = Partial<RowOf<Fields>>;

/** Insert and update payloads by column for facade writes. */
export type SimplePayload = Partial<RowOf<Fields>>;

/** Facade rows: plain records keyed by column. */
export type SimpleRow = RowOf<Fields>;

/** Fold a named field array into a struct, dropping nulls. */
function toStruct(table: string, fields: readonly NamedFieldDef[]): { table: string; fields: Fields } {
  const map: Record<string, Fields[string]> = {};
  for (const field of fields) {
    map[field.name] = {
      type: field.type,
      ...(field.required === undefined ? {} : { required: field.required }),
      ...(typeof field.length !== 'number' ? {} : { length: field.length }),
      ...(field.default === undefined || field.default === null ? {} : { default: field.default }),
      ...(field.enum === undefined ? {} : { enum: [...field.enum] }),
    };
  }
  return { table, fields: map };
}

/** Validate, insert, and return the new-row id. */
export function create(
  table: string,
  fields: readonly NamedFieldDef[],
  payload: SimplePayload,
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof createRow> {
  const built = toStruct(table, fields);
  return createRow(driver, defineStruct(built.table, built.fields), payload);
}

/** Read rows matching equality conditions. */
export function read(
  table: string,
  conditions: SimpleConditions = {},
  options: ReadOptions = {},
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof readRows> {
  return readRows(driver, defineStruct(table, {}), conditions, options);
}

/** Read a single row by equality conditions, or null when none matches. */
export function readOne(
  table: string,
  conditions: SimpleConditions = {},
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof readOneRow> {
  return readOneRow(driver, defineStruct(table, {}), conditions);
}

/** Read a single row by one column, throwing NotFoundError when absent. */
export function findOrFail(
  table: string,
  key: string,
  value: BindValue,
  driver: Driver = createMysqlDriver(),
): Promise<SimpleRow> {
  return findOrFailRow(driver, defineStruct<string, Fields>(table, {}), key, value);
}

/** Read rows across joins. Row shape is caller-specified. */
export function readWith<Row = Record<string, unknown>>(
  table: string,
  conditions: SimpleConditions = {},
  joins: readonly JoinSpec[] = [],
  options: ReadOptions = {},
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof readWithRows<Row>> {
  return readWithRows<Row>(driver, defineStruct(table, {}), joins, conditions, options);
}

/** Update a record by id, writing only the columns present in the payload. */
export function update(
  table: string,
  fields: readonly NamedFieldDef[],
  payload: SimplePayload,
  idKey = 'id',
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof updateRow> {
  const built = toStruct(table, fields);
  return updateRow(driver, defineStruct(built.table, built.fields), payload, idKey);
}

/** Delete a record by its id column value. */
export function remove(
  table: string,
  idKey: string,
  idValue: BindValue,
  driver: Driver = createMysqlDriver(),
): ReturnType<typeof removeRow> {
  return removeRow(driver, defineStruct<string, Fields>(table, {}), idKey, idValue);
}
