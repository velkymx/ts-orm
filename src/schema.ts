/**
 * Schema builder: DDL compiled per dialect from one column description.
 * Identifiers pass safeIdentifier, defaults escape quote doubling, and
 * delete rules come from a fixed allowlist. Engines differ, so support is
 * explicit: dropping foreign keys throws on SQLite (define them inline at
 * create time), and index creation is not idempotent on MySQL or MSSQL
 * (migrations run once through the tracking table, which is the guard).
 */

import type { Dialect } from './dialect.js';
import { safeIdentifier } from './identifiers.js';
import type { Fields, FieldType, Struct } from './struct.js';

/** Foreign key target plus an optional delete rule. */
export interface ReferenceDef {
  readonly table: string;
  readonly column: string;
  readonly onDelete?: string;
}

/** One column description for the DDL compilers below. */
export interface ColumnDef {
  readonly type: FieldType;
  readonly length?: number;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
  readonly primaryKey?: boolean;
  readonly autoIncrement?: boolean;
  readonly unique?: boolean;
  /**
   * Allowed values. MySQL enforces ENUM natively; other engines store
   * TEXT (VARCHAR on MSSQL) and rely on app-side validation instead.
   */
  readonly enum?: readonly string[];
  readonly references?: ReferenceDef;
}

/** Delete rules accepted on foreign keys. */
const DELETE_RULES = ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'];

/** Single-quote escaping for string literals and enum values. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Validated delete rule, or empty when absent. */
function deleteRule(rule: string | undefined): string {
  if (rule === undefined) {
    return '';
  }
  const upper = rule.toUpperCase();
  if (!DELETE_RULES.includes(upper)) {
    throw new Error(`unsupported onDelete rule: ${rule}`);
  }
  return ` ON DELETE ${upper}`;
}

/** Boolean literal per engine. */
function boolLiteral(dialect: Dialect, value: boolean): string {
  if (dialect.name === 'postgres') {
    return value ? 'TRUE' : 'FALSE';
  }
  return value ? '1' : '0';
}

/** Column storage type per engine. */
function typeSql(dialect: Dialect, column: ColumnDef): string {
  if (column.primaryKey === true && column.autoIncrement === true) {
    if (dialect.name === 'postgres') {
      return 'SERIAL';
    }
    if (dialect.name === 'sqlite') {
      return 'INTEGER';
    }
    return 'INT';
  }
  switch (column.type) {
    case 'number':
      return dialect.name === 'postgres' || dialect.name === 'sqlite' ? 'INTEGER' : 'INT';
    case 'string':
      if (dialect.name === 'sqlite' || column.length === undefined) {
        return 'TEXT';
      }
      return `VARCHAR(${column.length})`;
    case 'boolean':
      if (dialect.name === 'postgres') {
        return 'BOOLEAN';
      }
      if (dialect.name === 'mssql') {
        return 'BIT';
      }
      if (dialect.name === 'sqlite') {
        return 'INTEGER';
      }
      return 'TINYINT(1)';
    case 'date':
      return 'DATE';
    case 'decimal':
      // SQLite exactness needs TEXT affinity; NUMERIC would coerce through REAL.
      if (dialect.name === 'sqlite') {
        return 'TEXT';
      }
      // Bare NUMERIC means scale zero on MySQL (DECIMAL defaults to (10,0))
      // and SQL Server, silently rounding fractions. Emit the widest
      // lossless form instead; Postgres NUMERIC stays unconstrained and exact.
      if (dialect.name === 'mysql') {
        return 'DECIMAL(65, 30)';
      }
      if (dialect.name === 'mssql') {
        return 'DECIMAL(38, 30)';
      }
      return 'NUMERIC';
    case 'bigint':
      // Same exactness rule as decimal: TEXT on SQLite, native 64-bit elsewhere.
      if (dialect.name === 'sqlite') {
        return 'TEXT';
      }
      return 'BIGINT';
    case 'datetime':
      if (dialect.name === 'postgres') {
        return 'TIMESTAMP';
      }
      if (dialect.name === 'mssql') {
        return 'DATETIME2';
      }
      if (dialect.name === 'sqlite') {
        return 'TEXT';
      }
      return 'DATETIME';
    case 'uuid':
      if (dialect.name === 'postgres') {
        return 'UUID';
      }
      if (dialect.name === 'mssql') {
        return 'UNIQUEIDENTIFIER';
      }
      if (dialect.name === 'sqlite') {
        return 'TEXT';
      }
      return 'CHAR(36)';
    case 'enum':
      if (dialect.name === 'mysql') {
        return `ENUM(${(column.enum ?? []).map(quoted).join(',')})`;
      }
      if (dialect.name === 'mssql') {
        return 'VARCHAR(255)';
      }
      return 'TEXT';
  }
}

/** Rendered column default, or empty when none. */
function defaultSql(dialect: Dialect, column: ColumnDef): string {
  const value = column.default;
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return ` DEFAULT ${boolLiteral(dialect, value)}`;
  }
  if (typeof value === 'number') {
    return ` DEFAULT ${value}`;
  }
  if (/^current_timestamp$/i.test(value)) {
    return ' DEFAULT CURRENT_TIMESTAMP';
  }
  return ` DEFAULT ${quoted(value)}`;
}

/** One full column definition. */
function columnSql(dialect: Dialect, name: string, column: ColumnDef): string {
  const parts = [safeIdentifier(name, dialect, 'column name'), typeSql(dialect, column)];
  if (column.primaryKey === true) {
    // T-SQL binds IDENTITY to the type, so it precedes every constraint.
    if (dialect.name === 'mssql' && column.autoIncrement === true) {
      parts.push('IDENTITY(1,1)');
    } else if (dialect.name !== 'postgres') {
      parts.push('NOT NULL');
    }
    parts.push('PRIMARY KEY');
    if (column.autoIncrement === true) {
      if (dialect.name === 'mysql') {
        parts.push('AUTO_INCREMENT');
      } else if (dialect.name === 'sqlite') {
        parts.push('AUTOINCREMENT');
      }
    }
  } else {
    if (column.required === true) {
      parts.push('NOT NULL');
    }
    if (column.unique === true) {
      parts.push('UNIQUE');
    }
    const fallback = defaultSql(dialect, column);
    if (fallback) {
      parts.push(fallback.trim());
    }
  }
  if (column.references) {
    const ref = column.references;
    parts.push(
      `REFERENCES ${safeIdentifier(ref.table, dialect, 'table name')} ` +
        `(${safeIdentifier(ref.column, dialect, 'column name')})${deleteRule(ref.onDelete)}`,
    );
  }
  return parts.join(' ');
}

/**
 * CREATE TABLE guarded for safe retries, so a retried migration never
 * fails on an already built table. MySQL, Postgres, and SQLite use
 * IF NOT EXISTS; SQL Server has no such clause, so the statement is
 * wrapped in an OBJECT_ID null guard instead. Auto-increment primary
 * keys use each engine's native identity strategy.
 */
export function buildCreateTable(
  dialect: Dialect,
  table: string,
  columns: Record<string, ColumnDef>,
): string {
  const names = Object.keys(columns);
  if (names.length === 0) {
    throw new Error('createTable needs at least one column');
  }
  const defs = names.map((name) => columnSql(dialect, name, columns[name] as ColumnDef));
  const qualified = safeIdentifier(table, dialect, 'table name');
  if (dialect.name === 'mssql') {
    return `IF OBJECT_ID(N'${table}', N'U') IS NULL CREATE TABLE ${qualified} (${defs.join(', ')})`;
  }
  return `CREATE TABLE IF NOT EXISTS ${qualified} (${defs.join(', ')})`;
}

/** ALTER TABLE ADD COLUMN (ADD on MSSQL, which rejects the COLUMN keyword). */
export function buildAddColumn(dialect: Dialect, table: string, name: string, column: ColumnDef): string {
  const keyword = dialect.name === 'mssql' ? 'ADD' : 'ADD COLUMN';
  return `ALTER TABLE ${safeIdentifier(table, dialect, 'table name')} ${keyword} ${columnSql(dialect, name, column)}`;
}

/** ALTER TABLE DROP COLUMN. */
export function buildDropColumn(dialect: Dialect, table: string, name: string): string {
  return `ALTER TABLE ${safeIdentifier(table, dialect, 'table name')} DROP COLUMN ${safeIdentifier(name, dialect, 'column name')}`;
}

/** Default index name when the caller does not pick one. */
export function indexName(table: string, columns: readonly string[]): string {
  return `${table}_${columns.join('_')}_index`;
}

/** CREATE INDEX over the given columns, UNIQUE on request. */
export function buildCreateIndex(
  dialect: Dialect,
  table: string,
  columns: readonly string[],
  opts: { unique?: boolean; name?: string } = {},
): string {
  if (columns.length === 0) {
    throw new Error('createIndex needs at least one column');
  }
  const unique = opts.unique === true ? 'UNIQUE ' : '';
  const name = opts.name ?? indexName(table, columns);
  const list = columns.map((c) => safeIdentifier(c, dialect, 'column name')).join(', ');
  return `CREATE ${unique}INDEX ${safeIdentifier(name, dialect, 'index name')} ON ${safeIdentifier(table, dialect, 'table name')} (${list})`;
}

/** DROP INDEX in each engine's spelling, IF EXISTS where supported. */
export function buildDropIndex(dialect: Dialect, table: string, name: string): string {
  const quotedName = safeIdentifier(name, dialect, 'index name');
  if (dialect.name === 'mysql' || dialect.name === 'mssql') {
    return `DROP INDEX ${quotedName} ON ${safeIdentifier(table, dialect, 'table name')}`;
  }
  return `DROP INDEX IF EXISTS ${quotedName}`;
}

/**
 * Standalone ADD CONSTRAINT foreign key. SQLite cannot add (or drop)
 * constraints after creation, so it throws and callers define references
 * inline in buildCreateTable instead.
 */
export function buildAddForeignKey(
  dialect: Dialect,
  table: string,
  column: string,
  ref: ReferenceDef,
): string {
  if (dialect.name === 'sqlite') {
    throw new Error('sqlite cannot add foreign keys after creation: define them inline in createTable');
  }
  const name = `${table}_${column}_fkey`;
  return (
    `ALTER TABLE ${safeIdentifier(table, dialect, 'table name')} ` +
    `ADD CONSTRAINT ${safeIdentifier(name, dialect, 'constraint name')} ` +
    `FOREIGN KEY (${safeIdentifier(column, dialect, 'column name')}) ` +
    `REFERENCES ${safeIdentifier(ref.table, dialect, 'table name')} ` +
    `(${safeIdentifier(ref.column, dialect, 'column name')})${deleteRule(ref.onDelete)}`
  );
}

/**
 * Fold a struct into column definitions: auto_increment becomes an
 * auto-increment primary key, current_timestamp stays a bare default,
 * lengths and enum values carry over. Drop null lengths; the compiler
 * only reads defined keys.
 */
export function structColumns(struct: Struct<string, Fields>): Record<string, ColumnDef> {
  const out: Record<string, ColumnDef> = {};
  for (const [name, def] of Object.entries(struct.fields)) {
    out[name] = {
      type: def.type,
      required: def.required ?? false,
      ...(def.length === undefined ? {} : { length: def.length }),
      ...(def.enum === undefined ? {} : { enum: [...def.enum] }),
      ...(def.default === 'auto_increment'
        ? { primaryKey: true, autoIncrement: true }
        : def.default === 'current_timestamp'
          ? { default: 'CURRENT_TIMESTAMP' }
          : def.default === undefined || def.default === null
            ? {}
            : { default: def.default }),
    };
  }
  return out;
}
