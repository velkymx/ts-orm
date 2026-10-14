/**
 * MySQL driver. Wraps the shared mysql2 pool and normalizes its result shape
 * to the engine-agnostic Driver contract.
 */

import type { ResultSetHeader } from 'mysql2';
import { getPool, closePool } from '../connection.js';
import { mysql as mysqlDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';

export function createMysqlDriver(): Driver {
  return {
    dialect: mysqlDialect,

    async query<Row>(sql: string, params: readonly BindValue[]): Promise<Row[]> {
      const [rows] = await getPool().query(sql, params as BindValue[]);
      return rows as Row[];
    },

    async execute(sql: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      const [result] = await getPool().execute<ResultSetHeader>(sql, params as BindValue[]);
      return { insertId: result.insertId, affectedRows: result.affectedRows };
    },

    async close(): Promise<void> {
      await closePool();
    },

    async beginTransaction(): Promise<TxConnection> {
      const conn = await getPool().getConnection();
      await conn.beginTransaction();
      return {
        dialect: mysqlDialect,

        async query<Row>(sql: string, params: readonly BindValue[]): Promise<Row[]> {
          const [rows] = await conn.query(sql, params as BindValue[]);
          return rows as Row[];
        },

        async execute(sql: string, params: readonly BindValue[]): Promise<ExecuteResult> {
          const [result] = await conn.execute<ResultSetHeader>(sql, params as BindValue[]);
          return { insertId: result.insertId, affectedRows: result.affectedRows };
        },

        async close(): Promise<void> {},

        async commit(): Promise<void> {
          await conn.commit();
        },

        async rollback(): Promise<void> {
          await conn.rollback();
        },

        async release(): Promise<void> {
          conn.release();
        },
      };
    },
  };
}
