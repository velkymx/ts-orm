import { isValidUUID, isValidDatetime, isValidDate, isValidBoolean } from './security.js';

// Supported column types. Introspection and hand-written structs both produce
// these; anything unrecognized is treated as a plain string elsewhere.
export type FieldType = 'number' | 'string' | 'uuid' | 'datetime' | 'date' | 'boolean' | 'enum';

// A single column definition within a table struct. Shared across the ORM.
export interface Field {
    name: string;
    type: FieldType;
    required?: boolean;
    length?: number | null;
    default?: unknown;
    enum?: string[];
}

export interface ValidateOptions {
    // Insert path: an auto_increment column must not be supplied by the caller.
    skipAutoIncrement?: boolean;
    // Update path: absent required columns are left untouched rather than flagged.
    partial?: boolean;
}

export function validatePayload(struct: Field[], payload: Record<string, unknown>, options: ValidateOptions = {}): string[] {
    const errors: string[] = [];

    for (const field of struct) {
        const value = payload[field.name];
        const isAuto = field.default === 'auto_increment';
        const skipAuto = options.skipAutoIncrement && isAuto;

        // Prevent user from passing an auto_increment value on insert
        if (skipAuto && value !== undefined) {
            errors.push(`${field.name} should not be provided (auto_increment)`);
            continue;
        }

        if (skipAuto) continue;

        // Fix: Allow falsy values like false, 0, but reject undefined/null for required fields
        if (field.required && (value === undefined || value === null)) {
            // Partial updates only write the columns actually provided, so an
            // absent (undefined) required field is left as-is instead of being
            // flagged missing. An explicit null still errors, since that would
            // attempt to NULL a required column.
            if (options.partial && value === undefined) continue;
            errors.push(`${field.name} is required`);
            continue;
        }

        // Skip validation if value is undefined or null for non-required fields
        if (value === undefined || value === null) {
            continue;
        }

        // Number validation. Number('') and Number('   ') coerce to 0, so a blank
        // string would wrongly pass; reject empty/whitespace strings explicitly
        // and require a finite numeric value (also rejects NaN/Infinity).
        if (field.type === 'number') {
            const blankString = typeof value === 'string' && value.trim() === '';
            if (blankString || !Number.isFinite(Number(value))) {
                errors.push(`${field.name} must be a number`);
            }
        }

        // UUID validation
        if (field.type === 'uuid' && !isValidUUID(value)) {
            errors.push(`${field.name} must be a valid UUID`);
        }

        // Datetime validation (skip 'current_timestamp' default value)
        if (field.type === 'datetime' && value !== 'current_timestamp' && !isValidDatetime(value)) {
            errors.push(`${field.name} must be in format YYYY-MM-DD HH:MM:SS`);
        }

        // Date validation
        if (field.type === 'date' && !isValidDate(value)) {
            errors.push(`${field.name} must be in format YYYY-MM-DD`);
        }

        // Boolean validation
        if (field.type === 'boolean' && !isValidBoolean(value)) {
            errors.push(`${field.name} must be a boolean`);
        }

        // Enum validation (skip undefined/null for non-required fields)
        if (field.enum && !field.enum.includes(value as string)) {
            errors.push(`${field.name} must be one of ${field.enum.join(', ')}`);
        }

        // String length validation
        if (field.length && typeof value === 'string' && field.length > 0 && value.length > field.length) {
            errors.push(`${field.name} exceeds max length of ${field.length}`);
        }
    }

    return errors;
}
