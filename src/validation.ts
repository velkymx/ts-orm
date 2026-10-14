/**
 * Pure value validators for struct field types. Each is a total predicate over
 * unknown input: format is checked by pattern, then calendar values are proven
 * real with a round-trip through Date so impossible dates (e.g. Feb 30) fail.
 */

import type { Fields } from './struct.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a canonical v4 UUID (case-insensitive). */
export function isValidUUID(value: unknown): boolean {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** True for a `YYYY-MM-DD HH:MM:SS` value whose parts form a real calendar time. */
export function isValidDatetime(value: unknown): boolean {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    return false;
  }

  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart!.split('-').map(Number) as [number, number, number];
  const [hour, minute, second] = timePart!.split(':').map(Number) as [
    number,
    number,
    number,
  ];

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  return isRealDate(year, month, day);
}

/** True for a `YYYY-MM-DD` value that is a real calendar date. */
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number) as [number, number, number];

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  return isRealDate(year, month, day);
}

/** True for a boolean or the integer/string forms MySQL uses for one. */
export function isValidBoolean(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    value === 0 ||
    value === 1 ||
    value === '0' ||
    value === '1'
  );
}

/** A single payload validation failure, tied to the offending column. */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ValidateOptions {
  /** Reject caller-supplied auto_increment values (insert path). */
  readonly skipAutoIncrement?: boolean;
  /** Validate only the fields present in the payload (partial update path). */
  readonly partial?: boolean;
}

/**
 * Validate a payload against a struct's fields, returning one error per
 * offending column. Absent non-required fields are skipped; `partial` mode
 * skips absent required fields too so partial updates are not forced to
 * resend every column.
 */
export function validatePayload(
  fields: Fields,
  payload: Record<string, unknown>,
  options: ValidateOptions = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const name of Object.keys(fields)) {
    const def = fields[name]!;
    const value = payload[name];
    const isAuto = def.default === 'auto_increment';

    if (options.skipAutoIncrement && isAuto) {
      if (value !== undefined) {
        errors.push({ field: name, message: `${name} should not be provided (auto_increment)` });
      }
      continue;
    }

    if (value === undefined && options.partial) {
      continue;
    }

    if (def.required && (value === undefined || value === null)) {
      errors.push({ field: name, message: `${name} is required` });
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (def.type === 'number' && Number.isNaN(Number(value))) {
      errors.push({ field: name, message: `${name} must be a number` });
    }

    if (def.type === 'uuid' && !isValidUUID(value)) {
      errors.push({ field: name, message: `${name} must be a valid UUID` });
    }

    if (def.type === 'datetime' && value !== 'current_timestamp' && !isValidDatetime(value)) {
      errors.push({ field: name, message: `${name} must be in format YYYY-MM-DD HH:MM:SS` });
    }

    if (def.type === 'date' && !isValidDate(value)) {
      errors.push({ field: name, message: `${name} must be in format YYYY-MM-DD` });
    }

    if (def.type === 'boolean' && !isValidBoolean(value)) {
      errors.push({ field: name, message: `${name} must be a boolean` });
    }

    if (def.enum && !def.enum.includes(value as string)) {
      errors.push({ field: name, message: `${name} must be one of ${def.enum.join(', ')}` });
    }

    if (def.length && typeof value === 'string' && def.length > 0 && value.length > def.length) {
      errors.push({ field: name, message: `${name} exceeds max length of ${def.length}` });
    }
  }

  return errors;
}

/**
 * Check a raw database row against the struct, returning messages. Unlike
 * validatePayload this is strict about runtime types: a string where a
 * number belongs fails, because drivers hand back engine shapes, not app
 * shapes. Use it at ingestion boundaries; leave it off hot paths.
 */
export function validateRow<F extends Fields>(fields: F, row: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const name of Object.keys(fields)) {
    const def = fields[name]!;
    const value = row[name];
    if (value === null || value === undefined) {
      if (def.required) errors.push(`${name} is required`);
      continue;
    }
    if (def.type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
      errors.push(`${name} must be a number`);
    }
    if (def.type === 'string' && typeof value !== 'string') {
      errors.push(`${name} must be a string`);
    }
    if (def.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${name} must be a boolean`);
    }
    if (def.type === 'uuid' && !isValidUUID(value)) {
      errors.push(`${name} must be a valid UUID`);
    }
    if (def.type === 'datetime' && !isValidDatetime(value)) {
      errors.push(`${name} must be in format YYYY-MM-DD HH:MM:SS`);
    }
    if (def.type === 'date' && !isValidDate(value)) {
      errors.push(`${name} must be in format YYYY-MM-DD`);
    }
    if (def.enum && !def.enum.includes(value as string)) {
      errors.push(`${name} must be one of ${def.enum.join(', ')}`);
    }
  }
  return errors;
}
