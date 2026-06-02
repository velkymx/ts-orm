import type { Field } from './validator.js';

// Value casting between DB and JS based on the struct field types. Only the two
// transforms mysql2 doesn't already handle are applied:
//   - boolean: TINYINT(1) 0/1  <->  JS boolean
//   - json:    JSON text string <-> JS object/array
// (DATE/DATETIME are already returned as JS Date by mysql2.) null/undefined pass
// through untouched.

/** Cast one DB row in place (DB -> JS) using the struct. */
export function castReadRow(row: Record<string, unknown>, struct: Field[]): Record<string, unknown> {
    for (const field of struct) {
        const value = row[field.name];
        if (value === null || value === undefined) continue;
        if (field.type === 'boolean') {
            row[field.name] = Boolean(value);
        } else if (field.type === 'json' && typeof value === 'string') {
            // Leave the raw string if it isn't valid JSON rather than throwing.
            try {
                row[field.name] = JSON.parse(value);
            } catch {
                /* not JSON — keep as-is */
            }
        }
    }
    return row;
}

/** Cast result rows (DB -> JS). No-op when struct is absent or rows isn't an array. */
export function castReadRows(rows: unknown, struct: Field[] | null): unknown {
    if (!struct || !Array.isArray(rows)) return rows;
    for (const row of rows) {
        castReadRow(row as Record<string, unknown>, struct);
    }
    return rows;
}

/** Cast a single value for writing (JS -> DB) per its field type. */
export function castWriteValue(value: unknown, field: Field): unknown {
    if (value === null || value === undefined) return value;
    if (field.type === 'boolean') {
        return value === true || value === 1 || value === '1' ? 1 : 0;
    }
    if (field.type === 'json' && typeof value !== 'string') {
        return JSON.stringify(value);
    }
    return value;
}
