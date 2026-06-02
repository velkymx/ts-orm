import mysql from 'mysql2/promise';
import { getLogger } from './logger.js';

// SQL Identifier validation patterns
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]+$/;
const QUALIFIED_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/;

// Input format validation patterns
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Capture groups so the components can be read by index after a match.
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// MySQL error code mappings to safe messages. `as const` gives each known key a
// string literal type (so dotted access is never `undefined`).
const ERROR_MESSAGES = {
    ER_DUP_ENTRY: 'Record already exists',
    ER_DUP_KEY: 'Record already exists',
    ER_NO_REFERENCED_ROW: 'Related record not found',
    ER_NO_REFERENCED_ROW_2: 'Related record not found',
    ER_ROW_IS_REFERENCED: 'Cannot delete record - it is referenced by other records',
    ER_ROW_IS_REFERENCED_2: 'Cannot delete record - it is referenced by other records',
    ER_BAD_FIELD_ERROR: 'Invalid field name',
    ER_NO_SUCH_TABLE: 'Table not found',
    ER_BAD_TABLE_ERROR: 'Table not found',
    ER_PARSE_ERROR: 'Query syntax error',
    ER_ACCESS_DENIED_ERROR: 'Access denied',
    ER_WRONG_VALUE_COUNT: 'Invalid number of values',
    DEFAULT: 'Database operation failed'
} as const;

// Shape of the errors mysql2 throws: a standard Error plus driver metadata.
// Typed loosely because the values originate from an untyped catch clause.
type DbError = Error & { code?: string; errno?: number; sqlState?: string };

/**
 * Validates that an identifier contains only safe characters
 * @param identifier - The identifier to validate
 * @param context - Context for error message (e.g., 'table name', 'column name')
 * @returns True if valid
 * @throws If identifier is invalid
 */
export function validateIdentifier(identifier: string, context = 'identifier'): boolean {
    if (typeof identifier !== 'string' || identifier.length === 0) {
        throw new Error(`Invalid ${context}: must be a non-empty string`);
    }

    if (!IDENTIFIER_PATTERN.test(identifier)) {
        throw new Error(`Invalid ${context}: '${identifier}' contains illegal characters. Only alphanumeric and underscore allowed.`);
    }

    return true;
}

/**
 * Escapes an identifier using mysql2's escapeId
 * @param identifier - The identifier to escape
 * @returns Escaped identifier
 */
export function escapeIdentifier(identifier: string): string {
    return mysql.escapeId(identifier);
}

/**
 * Validates and escapes an identifier (hybrid approach)
 * @param identifier - The identifier to validate and escape
 * @param context - Context for error message
 * @returns Escaped identifier
 * @throws If identifier is invalid
 */
export function validateAndEscapeIdentifier(identifier: string, context = 'identifier'): string {
    validateIdentifier(identifier, context);
    return escapeIdentifier(identifier);
}

/**
 * Validates a qualified identifier (e.g., table.column)
 * @param qualifiedId - The qualified identifier to validate
 * @returns True if valid
 */
export function validateQualifiedIdentifier(qualifiedId: unknown): boolean {
    if (typeof qualifiedId !== 'string' || qualifiedId.length === 0) {
        return false;
    }
    return QUALIFIED_IDENTIFIER_PATTERN.test(qualifiedId);
}

/**
 * Validates UUID v4 format
 * @param value - The value to validate
 * @returns True if valid UUID v4
 */
export function isValidUUID(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    return UUID_V4_PATTERN.test(value);
}

/**
 * Validates datetime format (YYYY-MM-DD HH:MM:SS)
 * @param value - The value to validate
 * @returns True if valid datetime
 */
export function isValidDatetime(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }

    const m = value.match(DATETIME_PATTERN);
    if (!m) {
        return false;
    }

    // Capture groups are guaranteed present by the match; Number() coerces them.
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);

    // Basic range checks
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (hour < 0 || hour > 23) return false;
    if (minute < 0 || minute > 59) return false;
    if (second < 0 || second > 59) return false;

    // Check if date is valid using Date object
    const date = new Date(year, month - 1, day, hour, minute, second);
    return date.getFullYear() === year &&
           date.getMonth() === month - 1 &&
           date.getDate() === day;
}

/**
 * Validates date format (YYYY-MM-DD)
 * @param value - The value to validate
 * @returns True if valid date
 */
export function isValidDate(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }

    const m = value.match(DATE_PATTERN);
    if (!m) {
        return false;
    }

    // Capture groups are guaranteed present by the match; Number() coerces them.
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);

    // Basic range checks
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // Check if date is valid using Date object
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
           date.getMonth() === month - 1 &&
           date.getDate() === day;
}

/**
 * Validates boolean type
 * @param value - The value to validate
 * @returns True if valid boolean
 */
export function isValidBoolean(value: unknown): boolean {
    return typeof value === 'boolean' || value === 0 || value === 1 || value === '0' || value === '1';
}

/**
 * Sanitizes database errors and logs them server-side
 * @param error - The error to sanitize
 * @param operation - The operation that failed (e.g., 'create', 'read')
 * @param context - Additional context for logging (e.g., { table: 'users' })
 * @returns Sanitized error message safe for client
 */
export function sanitizeError(error: DbError, operation: string, context: Record<string, unknown> = {}): string {
    // Route the full error to the active logger (console by default). Only error
    // metadata + caller-supplied context are logged — never query values/bindings,
    // so payload PII never reaches the logs.
    getLogger().error(`${operation} operation failed`, {
        error: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        context
    });

    // Validation errors from our security module are safe to pass through
    // (they don't contain schema information, just validation messages)
    if (error.message && error.message.includes('Invalid')) {
        return error.message;
    }

    // Return sanitized message based on error code
    if (error.code && error.code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[error.code as keyof typeof ERROR_MESSAGES];
    }

    // Check if error message contains specific patterns
    if (error.message) {
        if (error.message.includes('Duplicate entry')) {
            return ERROR_MESSAGES.ER_DUP_ENTRY;
        }
        if (error.message.includes('foreign key constraint')) {
            return ERROR_MESSAGES.ER_ROW_IS_REFERENCED;
        }
    }

    // Default safe message
    return ERROR_MESSAGES.DEFAULT;
}
