/**
 * Migration runner: ordered up/down migrations with a tracking table.
 * Pending migrations run oldest first, each recorded after its `up`
 * succeeds, so a rerun only attempts what is missing. Rollback reverses
 * the latest batch in reverse order. DDL is not transactional on every
 * engine (MySQL commits DDL implicitly), so tracking writes follow the
 * migration, and builders favor IF NOT EXISTS for safe retries. The
 * `up` of one migration never depends on uncommitted later work.
 */

import type { BindValue, Driver } from './driver.js';
import type { Dialect } from './dialect.js';
import { timestampNow } from './lifecycle.js';
import { safeIdentifier } from './identifiers.js';
import { buildCreateTable } from './schema.js';

/** Tracking table holding applied migration names and batches. */
export const MIGRATIONS_TABLE = 'tsorm_migrations';

/** One versioned schema change with both directions. */
export interface Migration {
  /** Unique versioned name; timestamp prefixes keep files ordered. */
  readonly name: string;
  /** Apply the change. */
  up(driver: Driver): Promise<void>;
  /** Reverse the change. */
  down(driver: Driver): Promise<void>;
}

/** What migrate applied, and the batch number it recorded. */
export interface MigrateResult {
  readonly applied: string[];
  readonly batch: number;
}

/** What rollback reverted, latest first. */
export interface RollbackResult {
  readonly reverted: string[];
}

/** The runner's tracking statements, compiled per dialect. */
export interface TrackingSql {
  readonly createTable: string;
  readonly selectAll: string;
  readonly insertRow: string;
  readonly deleteRow: string;
}

/**
 * Tracking statements for a dialect. The table itself is built with the
 * schema builder, so identifier quoting, the key-safe name type, and
 * parameter markers all follow the engine: MySQL gets a VARCHAR primary
 * key (TEXT keys are illegal there), and Postgres/MSSQL get their own
 * placeholders instead of `?`.
 */
export function trackingSql(dialect: Dialect): TrackingSql {
  const table = safeIdentifier(MIGRATIONS_TABLE, dialect, 'table name');
  const name = safeIdentifier('name', dialect, 'column name');
  const batch = safeIdentifier('batch', dialect, 'column name');
  const appliedAt = safeIdentifier('applied_at', dialect, 'column name');
  return {
    createTable: buildCreateTable(dialect, MIGRATIONS_TABLE, {
      name: { type: 'string', length: 255, required: true, primaryKey: true },
      batch: { type: 'number', required: true },
      applied_at: { type: 'datetime', required: true },
    }),
    selectAll: `SELECT ${name}, ${batch} FROM ${table} ORDER BY ${name}`,
    insertRow:
      `INSERT INTO ${table} (${name}, ${batch}, ${appliedAt}) ` +
      `VALUES (${dialect.placeholder(1)}, ${dialect.placeholder(2)}, ${dialect.placeholder(3)})`,
    deleteRow: `DELETE FROM ${table} WHERE ${name} = ${dialect.placeholder(1)}`,
  };
}

/** Create the tracking table when absent, then read applied names to batches. */
async function appliedBatches(driver: Driver): Promise<Map<string, number>> {
  const sql = trackingSql(driver.dialect);
  await driver.execute(sql.createTable, []);
  const rows = await driver.query<Record<string, unknown>>(sql.selectAll, []);
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row['name'] as string, row['batch'] as number);
  }
  return out;
}

/**
 * Apply every migration not yet recorded, oldest first. Returns the
 * applied names and their batch. A failing `up` stops the run without
 * recording, so the next run retries exactly the remainder.
 */
export async function migrate(driver: Driver, migrations: readonly Migration[]): Promise<MigrateResult> {
  const ordered = [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const applied = await appliedBatches(driver);
  const pending = ordered.filter((m) => !applied.has(m.name));
  if (pending.length === 0) {
    return { applied: [], batch: 0 };
  }
  const table = trackingSql(driver.dialect);
  const batches = [...applied.values()];
  const batch = (batches.length > 0 ? Math.max(...batches) : 0) + 1;
  const names: string[] = [];
  for (const migration of pending) {
    await migration.up(driver);
    await driver.execute(table.insertRow, [
      migration.name,
      batch,
      timestampNow(),
    ] as BindValue[]);
    names.push(migration.name);
  }
  return { applied: names, batch };
}

/**
 * Reverse the latest batch (or the given number of batches), newest
 * first. Ordering is by migration name, so timestamp prefixes are the
 * contract: non-chronological names roll back in name order. Every
 * reverted name must resolve to a passed definition; unknown names throw
 * instead of guessing.
 */
export async function rollback(
  driver: Driver,
  migrations: readonly Migration[],
  opts: { batches?: number } = {},
): Promise<RollbackResult> {
  const count = opts.batches ?? 1;
  const applied = await appliedBatches(driver);
  if (applied.size === 0) {
    return { reverted: [] };
  }
  const sql = trackingSql(driver.dialect);
  const latest = Math.max(...applied.values());
  const floor = latest - count + 1;
  const names = [...applied.entries()]
    .filter(([, batch]) => batch >= floor)
    .map(([name]) => name)
    .sort()
    .reverse();
  const byName = new Map(migrations.map((m) => [m.name, m]));
  const reverted: string[] = [];
  for (const name of names) {
    const migration = byName.get(name);
    if (!migration) {
      throw new Error(`cannot roll back "${name}": no matching migration was passed`);
    }
    await migration.down(driver);
    await driver.execute(sql.deleteRow, [name] as BindValue[]);
    reverted.push(name);
  }
  return { reverted };
}
