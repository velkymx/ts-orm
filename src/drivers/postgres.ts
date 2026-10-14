/**
 * PostgreSQL driver built on the pg connection pool. Values are bound
 * positionally via the dialect's $N placeholders, and a new-row id is read
 * from the RETURNING row the query layer appends (insertIdStrategy 'returning').
 */

import * as pg from 'pg';
import { resolveConfig, type DbConfig } from '../config.js';
import { postgres as postgresDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';
import { OrmError, type OrmErrorCode } from '../errors.js';

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
      await client.query('BEGIN');
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
        },

        async rollback(): Promise<void> {
          await client.query('ROLLBACK');
        },

        async release(): Promise<void> {
          client.release();
        },

        async [Symbol.asyncDispose](): Promise<void> {
          client.release();
        },
      };
    },
  };
}
