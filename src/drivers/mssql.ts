/**
 * MS SQL Server / Azure SQL driver. Wraps a tedious-backed mssql ConnectionPool
 * and normalizes its result shape to the engine-agnostic Driver contract.
 *
 * Positional bind values are mapped to named @pN parameters, which is how the
 * mssql dialect renders placeholders. New-row ids arrive as a single-cell
 * recordset produced by an OUTPUT clause the query layer adds (insertIdStrategy
 * 'output').
 */

import type * as sql from 'mssql';
import { createRequire } from 'node:module';
import { resolveConfig, type DbConfig } from '../config.js';
import { mssql as mssqlDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';
import { OrmError, type OrmErrorCode } from '../errors.js';

const NUMBERS: Record<number, OrmErrorCode> = {
  2627: 'duplicate',
  2601: 'duplicate',
  547: 'foreign_key',
  515: 'not_null',
};

/** Normalize an mssql error (SQL Server number) into an OrmError. */
export function mapMssqlError(error: unknown): OrmError {
  const number = (error as { number?: number }).number;
  return new OrmError((number !== undefined && NUMBERS[number]) || 'unknown', error);
}

let pool: sql.ConnectionPool | null = null;
let sqlLib: typeof sql | null = null;

/**
 * Load the optional mssql peer on first use. Separated from peer() so tests
 * can stub the require and prove the missing-peer error is actionable.
 */
export function loadMssqlPeer(requirePeer: (id: string) => unknown = createRequire(import.meta.url)): typeof sql {
  try {
    return requirePeer('mssql') as typeof sql;
  } catch {
    throw new Error("mssql support needs the optional 'mssql' package: npm install mssql");
  }
}

/** The loaded peer, cached across pools. */
function peer(): typeof sql {
  if (!sqlLib) {
    sqlLib = loadMssqlPeer();
  }
  return sqlLib;
}
let overrides: Partial<DbConfig> | null = null;

/** Supply explicit configuration, overriding the environment. Resets the pool. */
export function configureMssql(config: Partial<DbConfig>): void {
  overrides = config;
  if (pool) {
    void pool.close();
    pool = null;
  }
}

function toMssqlConfig(cfg: DbConfig): sql.config {
  // Azure SQL requires TLS; encrypt defaults on for both Azure and modern SQL Server.
  return {
    server: cfg.host,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    port: cfg.port,
    options: { encrypt: true, trustServerCertificate: false },
  };
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await new (peer().ConnectionPool)(toMssqlConfig(resolveConfig(overrides ?? {}))).connect();
  }
  return pool;
}

function bind(request: sql.Request, params: readonly BindValue[]): void {
  params.forEach((value, index) => request.input(`p${index + 1}`, value));
}

/** Normalize an mssql result into the engine-agnostic write outcome. */
function toExecuteResult(result: sql.IResult<unknown>): ExecuteResult {
  const affectedRows = result.rowsAffected.reduce((sum, n) => sum + n, 0);
  const firstRow: Record<string, unknown> | undefined = result.recordset?.[0] as
    | Record<string, unknown>
    | undefined;
  const insertId = firstRow ? (Object.values(firstRow)[0] as number | string) : undefined;
  return insertId === undefined ? { affectedRows } : { insertId, affectedRows };
}

export function createMssqlDriver(): Driver {
  async function close(): Promise<void> {
    if (pool) {
      await pool.close();
      pool = null;
    }
  }

  return {
    dialect: mssqlDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      try {
        const request = (await getPool()).request();
        bind(request, params);
        const result = await request.query<Row>(text);
        return result.recordset ?? [];
      } catch (error) {
        throw mapMssqlError(error);
      }
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      try {
        const request = (await getPool()).request();
        bind(request, params);
        const result = await request.query(text);
        return toExecuteResult(result);
      } catch (error) {
        throw mapMssqlError(error);
      }
    },

    close,

    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },

    async beginTransaction(): Promise<TxConnection> {
      const tx = new (peer().Transaction)(await getPool());
      try {
        await tx.begin();
      } catch (error) {
        throw mapMssqlError(error);
      }
      return {
        dialect: mssqlDialect,

        async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
          try {
            const request = new (peer().Request)(tx);
            bind(request, params);
            const result = await request.query<Row>(text);
            return result.recordset ?? [];
          } catch (error) {
            throw mapMssqlError(error);
          }
        },

        async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
          try {
            const request = new (peer().Request)(tx);
            bind(request, params);
            const result = await request.query(text);
            return toExecuteResult(result);
          } catch (error) {
            throw mapMssqlError(error);
          }
        },

        async close(): Promise<void> {},

        async commit(): Promise<void> {
          await tx.commit();
        },

        async rollback(): Promise<void> {
          await tx.rollback();
        },

        async release(): Promise<void> {},

        // Matches release: the mssql transaction needs no manual return.
        async [Symbol.asyncDispose](): Promise<void> {},
      };
    },
  };
}
