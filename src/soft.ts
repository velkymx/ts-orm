/**
 * Soft delete plumbing. The convention column is deleted_at: when a struct
 * declares it and the model opts in with static softDeletes, delete stamps
 * the column instead of removing the row and reads hide stamped rows.
 * Relation loaders filter on column presence alone, since they only see
 * structs; Model reads additionally require the flag. Raw CRUD and raw SQL
 * never scope, so bulk paths stay explicit.
 */

import { timestampNow } from './lifecycle.js';
import type { Fields, Struct } from './struct.js';

/** Convention column carrying the soft delete stamp. */
export const SOFT_COLUMN = 'deleted_at';

/** True when the struct declares the soft delete column. */
export function hasSoftColumn(struct: Struct<string, Fields>): boolean {
  return Object.hasOwn(struct.fields, SOFT_COLUMN);
}

/** The soft delete column, throwing a clear error when it is missing. */
export function requireSoftColumn(struct: Struct<string, Fields>): string {
  if (!hasSoftColumn(struct)) {
    throw new Error(`soft deletes require a ${SOFT_COLUMN} column on "${struct.table}"`);
  }
  return SOFT_COLUMN;
}

/**
 * The active soft column for a model constructor, or null when opted out.
 * Throws when the flag is set without the column, so misconfiguration
 * fails fast instead of silently deleting physically.
 */
export function softColumnOf(ctor: unknown, struct: Struct<string, Fields>): string | null {
  const flag = (ctor as { softDeletes?: boolean }).softDeletes ?? false;
  if (!flag) {
    return null;
  }
  return requireSoftColumn(struct);
}

/** Fresh stamp for a soft delete, sharing the timestamp format. */
export function softStamp(): string {
  return timestampNow();
}

/** True when the row carries a soft delete stamp. */
export function isTrashed(row: Record<string, unknown>): boolean {
  const value = row[SOFT_COLUMN];
  return value !== undefined && value !== null;
}
