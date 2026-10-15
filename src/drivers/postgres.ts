/**
 * PostgreSQL driver built on the pg connection pool. Values are bound
 * positionally via the dialect's $N placeholders, and a new-row id is read
 * from the RETURNING row the query layer appends (insertIdStrategy 'returning').
 */

import type * as pg from 'pg';
import { createRequire } from 'node:module';
import { resolveConfig, type DbConfig } from '../config.js';
import { postgres as postgresDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';
import { OrmError, logError, type OrmErrorCode } from '../errors.js';

const CODES: Record<string, OrmErrorCode> = {
  '23505': 'duplicate',
  '23503': 'foreign_key',
  '23502': 'not_null',
};

/** Normalize a pg error (SQLSTATE in `code`) into an OrmError. */
export function mapPostgresError(error: unknown): OrmError {
  const code = (error as { code?: string }).code;
  return new OrmError((code ? CODES[code] : undefined) ?? 'unknown', error);
}

let pool: pg.Pool | null = null;
let overrides: Partial<DbConfig> | null = null;
let pgLib: typeof pg | null = null;

/**
 * Load the optional pg peer on first use. Separated from peer() so tests
 * can stub the require and prove the missing-peer error is actionable.
 */
export function loadPgPeer(requirePeer: (id: string) => unknown = createRequire(import.meta.url)): typeof pg {
  try {
    return requirePeer('pg') as typeof pg;
  } catch {
    throw new Error("postgres support needs the optional 'pg' package: npm install pg");
  }
}

/** The loaded peer, cached across pools. */
function peer(): typeof pg {
  if (!pgLib) {
    pgLib = loadPgPeer();
  }
  return pgLib;
}

/** Supply explicit configuration, overriding the environment. Resets the pool. Reconfigure only when quiescent; the old pool drains in the background with failures logged. */
export function configurePostgres(config: Partial<DbConfig>): void {
  overrides = config;
  if (pool) {
    const old = pool;
    pool = null;
    old.end().catch((error: unknown) => logError('postgres pool shutdown failed', error));
  }
}

function getPool(): pg.Pool {
  if (!pool) {
    const cfg = resolveConfig(overrides ?? {});
    pool = new (peer().Pool)({
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
  async function close(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }

  return {
    dialect: postgresDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      try {
        const result = await getPool().query(text, params as unknown[]);
        return result.rows as Row[];
      } catch (error) {
        throw mapPostgresError(error);
      }
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      try {
        const result = await getPool().query(text, params as unknown[]);
        const affectedRows = result.rowCount ?? 0;
        const firstRow: Record<string, unknown> | undefined = result.rows[0];
        const insertId = firstRow ? (Object.values(firstRow)[0] as number | string) : undefined;
        return insertId === undefined ? { affectedRows } : { insertId, affectedRows };
      } catch (error) {
        throw mapPostgresError(error);
      }
    },

    close,

    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },

    async beginTransaction(): Promise<TxConnection> {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
      } catch (error) {
        client.release();
        throw mapPostgresError(error);
      }
      let settled = false;
      return {
        dialect: postgresDialect,

        async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
          try {
            const result = await client.query(text, params as unknown[]);
            return result.rows as Row[];
          } catch (error) {
            throw mapPostgresError(error);
          }
        },

        async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
          try {
            const result = await client.query(text, params as unknown[]);
            const affectedRows = result.rowCount ?? 0;
            const firstRow: Record<string, unknown> | undefined = result.rows[0];
            const insertId = firstRow ? (Object.values(firstRow)[0] as number | string) : undefined;
            return insertId === undefined ? { affectedRows } : { insertId, affectedRows };
          } catch (error) {
            throw mapPostgresError(error);
          }
        },

        async close(): Promise<void> {},

        async commit(): Promise<void> {
          await client.query('COMMIT');
          settled = true;
        },

        async rollback(): Promise<void> {
          await client.query('ROLLBACK');
          settled = true;
        },

        async release(): Promise<void> {
          client.release();
        },

        async [Symbol.asyncDispose](): Promise<void> {
          try {
            if (!settled) {
              await client.query('ROLLBACK');
              settled = true;
            }
          } finally {
            client.release();
          }
        },
      };
    },
  };
}
