/**
 * Public entry point. Curated surface for the compiled package: struct
 * declarations drive types, CRUD plus the fluent builder cover the query
 * layer, drivers cover engines. Legacy plain JS modules stay out.
 */

export type {
  FieldType,
  FieldDef,
  Fields,
  Struct,
  ScalarOf,
  RowOf,
  InsertOf,
  UpdateOf,
} from './struct.js';
export { defineStruct } from './struct.js';

export type { Ok, Err, Result } from './result.js';
export { ok, fail } from './result.js';

export type { OrmErrorCode, Logger } from './errors.js';
export { OrmError, setLogger, resetLogger, sanitizeError } from './errors.js';

export type { SafeIdentifier } from './identifiers.js';
export { isIdentifier, isQualifiedIdentifier, safeIdentifier, safeQualified, escapeLike } from './identifiers.js';

export type { DialectName, InsertIdStrategy, Dialect } from './dialect.js';
export { mysql, postgres, sqlite, mssql } from './dialect.js';

export type { BindValue, ExecuteResult, Driver, TxConnection } from './driver.js';

export type { DbConfig } from './config.js';
export { resolveConfig } from './config.js';
export { configure, getPool, closePool } from './connection.js';

export type { ValidationError, ValidateOptions } from './validation.js';
export {
  isValidUUID,
  isValidDatetime,
  isValidDate,
  isValidBoolean,
  validatePayload,
} from './validation.js';

export type { BuiltStatement, ReadOptions, JoinSpec } from './crud.js';
export {
  buildInsert,
  buildSelect,
  buildSelectWith,
  buildUpdate,
  buildDelete,
  primaryKey,
  create,
  read,
  readOne,
  readWith,
  findOrFail,
  update,
  remove,
  NotFoundError,
} from './crud.js';

export type { ComparisonOperator, BooleanOp, GroupFn } from './query.js';
export { QueryBuilder, query } from './query.js';

export { TransactionNotSupportedError, TxHandle, beginTransaction, transaction } from './transaction.js';

export type { ModelInstance, ModelStatic } from './model.js';
export { defineModel } from './model.js';

export { createMysqlDriver } from './drivers/mysql.js';
export { mapMysqlError } from './drivers/mysql.js';
export { configurePostgres, createPostgresDriver } from './drivers/postgres.js';
export { mapPostgresError } from './drivers/postgres.js';
export type { SqliteOptions } from './drivers/sqlite.js';
export { mapSqliteError, createSqliteDriver } from './drivers/sqlite.js';
export { configureMssql, createMssqlDriver } from './drivers/mssql.js';
export { mapMssqlError } from './drivers/mssql.js';
