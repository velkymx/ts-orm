/**
 * Schema introspection (MySQL). Reads a live table through the shared
 * driver and maps each column to a struct field, matching the legacy
 * mapping shape with two fixes: tinyint maps to boolean only for
 * tinyint(1) (wider widths stay numbers), and no private pool is opened.
 * Output rows carry their column name; fold them into `defineStruct`
 * (dropping null lengths) to declare the model.
 */

import type { BindValue, Driver } from './driver.js';
import { safeIdentifier } from './identifiers.js';
import type { FieldType } from './struct.js';

/** One row of MySQL SHOW COLUMNS, as returned by the driver. */
export interface ShowColumnRow {
  readonly Field: string;
  readonly Type: string;
  readonly Null: string;
  readonly Default: unknown;
  readonly Extra: string;
}

/** One mapped column: its name plus the struct field definition. */
export interface IntrospectedField {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly length: number | null;
  readonly default: string | null;
  readonly enum?: readonly string[];
}

const TYPE_MAP: Record<string, FieldType> = {
  int: 'number',
  bigint: 'number',
  varchar: 'string',
  char: 'string',
  text: 'string',
  date: 'date',
  datetime: 'datetime',
  // TIMESTAMP shares the datetime cast, which reads UTC. Only correct under
  // a UTC session; the engine converts TIMESTAMP across session time zones.
  timestamp: 'datetime',
  enum: 'enum',
  json: 'string',
};

/** First parenthesized group of a column type, or undefined when bare. */
function typeArg(rawType: string): string | undefined {
  const open = rawType.indexOf('(');
  if (open === -1) {
    return undefined;
  }
  const close = rawType.indexOf(')', open + 1);
  return close === -1 ? undefined : rawType.slice(open + 1, close);
}

/**
 * Enum values honoring quoted commas, falling back to comma split. Scans the
 * string in one linear pass rather than a regex, so a crafted column type
 * cannot force quadratic backtracking.
 */
function enumValues(rawType: string): readonly string[] {
  const values: string[] = [];
  let i = 0;
  while (i < rawType.length) {
    if (rawType.charAt(i) !== "'") {
      i += 1;
      continue;
    }
    i += 1;
    let value = '';
    let closed = false;
    while (i < rawType.length) {
      const ch = rawType.charAt(i);
      if (ch === '\\' && i + 1 < rawType.length) {
        value += ch + rawType.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === "'") {
        closed = true;
        i += 1;
        break;
      }
      value += ch;
      i += 1;
    }
    if (closed) {
      values.push(value);
    }
  }
  if (values.length > 0) {
    return values;
  }
  const arg = typeArg(rawType) ?? '';
  return arg.length > 0 ? arg.split(',') : [];
}

/** Resolve the struct default from SHOW COLUMNS nullability and default. */
function resolveDefault(row: ShowColumnRow, auto: boolean): string | null {
  if (auto) {
    return 'auto_increment';
  }
  const current = row.Default;
  if (typeof current === 'string') {
    const bare = current.toLowerCase().replace(/\(\)$/, '');
    return bare === 'current_timestamp' ? 'current_timestamp' : current;
  }
  if (current === null || current === undefined) {
    return row.Null === 'NO' ? '' : null;
  }
  return String(current);
}

/**
 * Map one SHOW COLUMNS row to a struct field. Pure and engine free,
 * so the full matrix is unit testable without a database.
 */
export function mapColumnToField(row: ShowColumnRow): IntrospectedField {
  const name = String(row.Field);
  const rawType = String(row.Type).toLowerCase();
  const baseType = rawType.split('(')[0] as string;
  const width = Number.parseInt(typeArg(rawType) ?? '', 10);
  const auto = String(row.Extra ?? '').includes('auto_increment');

  // Only tinyint(1) is a boolean alias; wider widths hold small numbers.
  const type: FieldType =
    baseType === 'tinyint'
      ? width === 1
        ? 'boolean'
        : 'number'
      : (baseType === 'char' || baseType === 'varchar') &&
          width === 36 &&
          name.toLowerCase().includes('id')
        ? 'uuid'
        : (TYPE_MAP[baseType] ?? 'string');

  const length = type === 'enum' ? null : type === 'date' ? 10 : type === 'datetime' ? 19 : width || null;

  return {
    name,
    type,
    required: row.Null === 'NO',
    length,
    default: resolveDefault(row, auto),
    ...(type === 'enum' ? { enum: enumValues(rawType) } : {}),
  };
}

/**
 * Introspect a table into struct fields. Runs SHOW COLUMNS over the
 * given driver (shared pool, never a private one) with the table name
 * validated as an identifier. MySQL only; other engines fail at the
 * engine when they meet SHOW COLUMNS.
 */
export async function generateStructFromTable(driver: Driver, table: string): Promise<IntrospectedField[]> {
  const safe = safeIdentifier(table, driver.dialect, 'table name');
  const rows = await driver.query<ShowColumnRow>(`SHOW COLUMNS FROM ${safe}`, [] as BindValue[]);
  return rows.map(mapColumnToField);
}
