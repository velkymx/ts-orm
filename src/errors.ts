/**
 * Unified error route. Drivers normalize their client library's failures into
 * an OrmError carrying a normalized code; this module maps that code to a safe
 * client message and logs the full detail server-side. The caller never sees
 * raw driver or schema text.
 */

export type OrmErrorCode = 'duplicate' | 'foreign_key' | 'not_null' | 'not_found' | 'unknown';

/** A database failure normalized to an engine-agnostic code. */
export class OrmError extends Error {
  readonly code: OrmErrorCode;

  constructor(code: OrmErrorCode, cause?: unknown) {
    super(`Database error: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'OrmError';
    this.code = code;
  }
}

const MESSAGES: Record<OrmErrorCode, string> = {
  duplicate: 'Record already exists',
  foreign_key: 'Related record constraint failed',
  not_null: 'A required field was missing',
  not_found: 'Record not found',
  unknown: 'Database operation failed',
};

/** Server-side logger. Replaceable so hosts and tests can capture detail. */
export type Logger = (message: string, detail: unknown) => void;

const defaultLogger: Logger = (message, detail) => console.error(message, detail);
let logger: Logger = defaultLogger;

/** Install a custom server-side logger. */
export function setLogger(next: Logger): void {
  logger = next;
}

/** Restore the default console logger. */
export function resetLogger(): void {
  logger = defaultLogger;
}

/**
 * Log full detail server-side and return a safe message for the client.
 * Non-OrmError input is treated as unknown so nothing raw ever leaks.
 */
export function sanitizeError(error: unknown, operation: string): string {
  const code: OrmErrorCode = error instanceof OrmError ? error.code : 'unknown';
  const detail = error instanceof OrmError ? (error.cause ?? error) : error;
  logger(`[ts-orm] ${operation} operation failed`, detail);
  return MESSAGES[code];
}
