import { pool } from './db.js';
import { validateAndEscapeIdentifier } from './security.js';
import type { Field, FieldType } from './validator.js';

// Maps MySQL base column types to the ORM's field types.
const typeMap: Record<string, FieldType> = {
  int: 'number',
  bigint: 'number',
  tinyint: 'boolean',
  varchar: 'string',
  char: 'string',
  text: 'string',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  enum: 'enum',
  json: 'string'
};

// Shape of a `SHOW COLUMNS` result row.
interface ColumnRow {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string | null;
  Extra: string;
}

export async function generateStructFromTable(table: string): Promise<Field[]> {
  // Validate and escape table name
  const safeTable = validateAndEscapeIdentifier(table, 'table name');
  const [rows] = await pool.execute(`SHOW COLUMNS FROM ${safeTable}`);
  const columns = rows as ColumnRow[];

  const struct = columns.map((col): Field => {
    const rawType = col.Type.toLowerCase();
    const lengthMatch = rawType.match(/\((.*?)\)/);
    const baseType = rawType.split('(')[0];
    const isEnum = baseType === 'enum';
    const isAuto = col.Extra.includes('auto_increment');

    const isUuid =
      (baseType === 'char' || baseType === 'varchar') &&
      parseInt(lengthMatch?.[1] ?? '') === 36 &&
      col.Field.toLowerCase().includes('id');

    const type: FieldType = isUuid
      ? 'uuid'
      : typeMap[baseType] || 'string';

    let length: number | null = null;
    if (isEnum) {
      length = null;
    } else if (type === 'date') {
      length = 10; // YYYY-MM-DD
    } else if (type === 'datetime') {
      length = 19; // YYYY-MM-DD HH:MM:SS
    } else {
      length = parseInt(lengthMatch?.[1] ?? '') || null;
    }

    return {
      name: col.Field,
      type,
      required: col.Null === 'NO',
      length,
      default: isAuto
        ? 'auto_increment'
        : col.Default?.toLowerCase() === 'current_timestamp'
          ? 'current_timestamp'
          : col.Default === null
            ? (col.Null === 'NO' ? '' : null)
            : col.Default,
      ...(isEnum
        ? {
            enum: lengthMatch![1]
              .replace(/'/g, '')
              .split(',')
          }
        : {})
    };
  });

  return struct;
}
