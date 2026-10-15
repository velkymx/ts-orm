/**
 * Single shared connection pool. Created lazily on first use (never at import
 * time) so configuration problems surface at a predictable point, and closable
 * so scripts and tests can let the process exit cleanly.
 */

import { createPool, type Pool } from 'mysql2/promise';
import { resolveConfig, type DbConfig } from './config.js';
import { logError } from './errors.js';

let pool: Pool | null = null;
let overrides: Partial<DbConfig> | null = null;

/**
 * Supply explicit configuration, overriding the environment. Resets any
 * existing pool so the next `getPool` picks up the new settings. The old
 * pool drains in the background with failures logged, never unobserved;
 * reconfigure only when quiescent, since in-flight work keeps its pool.
 */
export function configure(config: Partial<DbConfig>): void {
  overrides = config;
  if (pool) {
    const old = pool;
    pool = null;
    old.end().catch((error: unknown) => logError('mysql pool shutdown failed', error));
  }
}

/** Return the shared pool, creating it from the resolved config on first call. */
export function getPool(): Pool {
  if (!pool) {
    const cfg = resolveConfig(overrides ?? {});
    pool = createPool({
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ...(cfg.port === undefined ? {} : { port: cfg.port }),
      // BIGINT and DECIMAL arrive as exact-digit strings, matching pg.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  return pool;
}

/** Close the shared pool so the process can exit. Safe to call when idle. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
