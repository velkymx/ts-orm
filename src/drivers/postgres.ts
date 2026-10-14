/**
 * PostgreSQL driver built on the pg connection pool. Values are bound
 * positionally via the dialect's $N placeholders, and a new-row id is read
 * from the RETURNING row the query layer appends (insertIdStrategy 'returning').
 */

import * as pg from 'pg';
import { resolveConfig, type DbConfig } from '../config.js';
import { postgres as postgresDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult } from '../driver.js';

let pool: pg.Pool | null = null;
let overrides: Partial<DbConfig> | null = null;

/** Supply explicit configuration, overriding the environment. Resets the pool. */
export function configurePostgres(config: Partial<DbConfig>): void {
  overrides = config;
  if (pool) {
    void pool.end();
    pool = null;
  }
}

function getPool(): pg.Pool {
  if (!pool) {
    const cfg = resolveConfig(overrides ?? {});
    pool = new pg.Pool({
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      port: cfg.port,
    });
  }
  return pool;
}

export function createPostgresDriver(): Driver {
  return {
    dialect: postgresDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      const result = await getPool().query(text, params as unknown[]);
      return result.rows as Row[];
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      const result = await getPool().query(text, params as unknown[]);
      const affectedRows = result.rowCount ?? 0;
      const firstRow: Record<string, unknown> | undefined = result.rows[0];
      const insertId = firstRow ? (Object.values(firstRow)[0] as number | string) : undefined;
      return insertId === undefined ? { affectedRows } : { insertId, affectedRows };
    },

    async close(): Promise<void> {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };
}
