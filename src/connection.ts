/**
 * Single shared connection pool. Created lazily on first use (never at import
 * time) so configuration problems surface at a predictable point, and closable
 * so scripts and tests can let the process exit cleanly.
 */

import { createPool, type Pool } from 'mysql2/promise';
import { resolveConfig, type DbConfig } from './config.js';

let pool: Pool | null = null;
let overrides: Partial<DbConfig> | null = null;

/**
 * Supply explicit configuration, overriding the environment. Resets any
 * existing pool so the next `getPool` picks up the new settings.
 */
export function configure(config: Partial<DbConfig>): void {
  overrides = config;
  if (pool) {
    void pool.end();
    pool = null;
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
      port: cfg.port,
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
