/**
 * MS SQL Server / Azure SQL driver. Wraps a tedious-backed mssql ConnectionPool
 * and normalizes its result shape to the engine-agnostic Driver contract.
 *
 * Positional bind values are mapped to named @pN parameters, which is how the
 * mssql dialect renders placeholders. New-row ids arrive as a single-cell
 * recordset produced by an OUTPUT clause the query layer adds (insertIdStrategy
 * 'output').
 */

import * as sql from 'mssql';
import { resolveConfig, type DbConfig } from '../config.js';
import { mssql as mssqlDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult } from '../driver.js';

let pool: sql.ConnectionPool | null = null;
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
    pool = await new sql.ConnectionPool(toMssqlConfig(resolveConfig(overrides ?? {}))).connect();
  }
  return pool;
}

function bind(request: sql.Request, params: readonly BindValue[]): void {
  params.forEach((value, index) => request.input(`p${index + 1}`, value));
}

export function createMssqlDriver(): Driver {
  return {
    dialect: mssqlDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      const request = (await getPool()).request();
      bind(request, params);
      const result = await request.query<Row>(text);
      return result.recordset;
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      const request = (await getPool()).request();
      bind(request, params);
      const result = await request.query(text);
      const affectedRows = result.rowsAffected.reduce((sum, n) => sum + n, 0);
      const firstRow: Record<string, unknown> | undefined = result.recordset?.[0];
      const insertId = firstRow ? (Object.values(firstRow)[0] as number | string) : undefined;
      return insertId === undefined ? { affectedRows } : { insertId, affectedRows };
    },

    async close(): Promise<void> {
      if (pool) {
        await pool.close();
        pool = null;
      }
    },
  };
}
