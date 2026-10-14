/**
 * Attribute casts: the pipeline between storage shapes and app shapes.
 * Structs describe storage, casts declare intent, and these functions
 * translate both ways plus compare normalized values for dirty tracking.
 * Raw builder rows stay untouched; casts apply at the model layer only.
 */

/** App-level value kinds a column can cast to. */
export type CastType = 'boolean' | 'integer' | 'datetime' | 'json';

/** Column name to cast kind. Unlisted columns pass through. */
export type Casts = Record<string, CastType>;

/** A cast failure naming its column, so callers know what to fix. */
export class CastError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'CastError';
    this.field = field;
  }
}

const DATETIME_SHAPE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parse a `YYYY-MM-DD HH:MM:SS` value as UTC, or undefined when misshapen. */
function parseStamp(value: string): Date | undefined {
  const parts = DATETIME_SHAPE.exec(value);
  if (!parts) {
    return undefined;
  }
  const date = new Date(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]), Number(parts[6])),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Normalize one storage value to its app shape. Null stays null. */
function outValue(field: string, type: CastType, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  switch (type) {
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1') return true;
      if (value === 0 || value === '0' || value === '') return false;
      throw new CastError(field, `cannot cast ${JSON.stringify(value)} to boolean`);
    }
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new CastError(field, `cannot cast ${JSON.stringify(value)} to integer`);
      }
      return Math.trunc(n);
    }
    case 'datetime': {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new CastError(field, 'invalid Date');
        return new Date(value.getTime());
      }
      if (typeof value === 'string') {
        const date = parseStamp(value) ?? new Date(value);
        if (Number.isNaN(date.getTime())) throw new CastError(field, `cannot cast ${JSON.stringify(value)} to datetime`);
        return date;
      }
      throw new CastError(field, `cannot cast ${JSON.stringify(value)} to datetime`);
    }
    case 'json': {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        throw new CastError(field, 'invalid JSON text');
      }
    }
  }
}

/** Normalize one app value to its storage shape. Null stays null. */
function inValue(field: string, type: CastType, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  switch (type) {
    case 'boolean':
      return outValue(field, type, value) ? 1 : 0;
    case 'integer':
      return outValue(field, type, value);
    case 'datetime': {
      const date = outValue(field, type, value) as Date;
      return date.toISOString().slice(0, 19).replace('T', ' ');
    }
    case 'json': {
      if (typeof value === 'string') {
        outValue(field, type, value);
        return JSON.stringify(outValue(field, type, value));
      }
      return JSON.stringify(value);
    }
  }
}

/** Translate a database row to app shapes for the declared columns. */
export function castOut(row: Record<string, unknown>, casts: Casts): Record<string, unknown> {
  const out = { ...row };
  for (const field of Object.keys(casts)) {
    if (field in out) {
      out[field] = outValue(field, casts[field] as CastType, out[field]);
    }
  }
  return out;
}

/** Translate app values to storage shapes for the declared columns. */
export function castIn(payload: Record<string, unknown>, casts: Casts): Record<string, unknown> {
  const out = { ...payload };
  for (const field of Object.keys(casts)) {
    if (field in out) {
      out[field] = inValue(field, casts[field] as CastType, out[field]);
    }
  }
  return out;
}

/** Bool-like reading used only when one side is already boolean-adjacent. */
function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0' || value === '') return false;
  return undefined;
}

/** Reduce a value to a JSON-stable comparable: epochs, parsed JSON, raw else. */
function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const stamp = parseStamp(value);
    if (stamp) return stamp.getTime();
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) return value;
  return value;
}

/**
 * True when two values mean the same thing across representations:
 * 1 equals true, '{"a":1}' equals {a:1}, a stamp string equals its Date.
 * Null only ever equals null. Falls back to JSON-stable comparison.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = toBool(a);
  const right = toBool(b);
  if (left !== undefined && right !== undefined) return left === right;
  if (left !== undefined || right !== undefined) return false;
  return JSON.stringify(canonical(comparable(a))) === JSON.stringify(canonical(comparable(b)));
}

/**
 * Deeply sort object keys so representation order never counts as dirty.
 * Arrays keep order (JSON array order is significant) and Dates pass
 * through for the standard ISO serialization.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
