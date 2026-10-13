/**
 * Typed result envelope for every ts-orm operation.
 *
 * Discriminated on `success` so consumers narrow to `data` or `errors`
 * without optional chaining. Replaces the legacy untyped `formatResponse`.
 */

export interface Ok<T> {
  readonly success: true;
  readonly message: string;
  readonly data: T;
}

export interface Err {
  readonly success: false;
  readonly message: string;
  readonly errors: readonly string[];
}

export type Result<T> = Ok<T> | Err;

/** Build a success result. Message defaults to "OK" to keep call sites terse. */
export function ok<T>(data: T, message = 'OK'): Ok<T> {
  return { success: true, message, data };
}

/** Build a failure result. `errors` carries structured validation/driver detail. */
export function fail(message: string, errors: readonly string[] = []): Err {
  return { success: false, message, errors };
}
