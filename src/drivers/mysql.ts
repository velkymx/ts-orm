/**
 * MySQL driver. Wraps the shared mysql2 pool and normalizes its result shape
 * and errors to the engine-agnostic Driver contract.
 */

import type { ResultSetHeader } from 'mysql2';
import { getPool, closePool } from '../connection.js';
import { mysql as mysqlDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';
import { OrmError, type OrmErrorCode } from '../errors.js';

const CODES: Record<string, OrmErrorCode> = {
  ER_DUP_ENTRY: 'duplicate',
  ER_DUP_KEY: 'duplicate',
  ER_NO_REFERENCED_ROW: 'foreign_key',
  ER_NO_REFERENCED_ROW_2: 'foreign_key',
  ER_ROW_IS_REFERENCED: 'foreign_key',
  ER_ROW_IS_REFERENCED_2: 'foreign_key',
  ER_BAD_NULL_ERROR: 'not_null',
};

/** Normalize a mysql2 error into an OrmError. */
export function mapMysqlError(error: unknown): OrmError {
  const code = (error as { code?: string }).code;
  return new OrmError((code ? CODES[code] : undefined) ?? 'unknown', error);
}

export function createMysqlDriver(): Driver {
  return {
    dialect: mysqlDialect,

    async query<Row>(sql: string, params: readonly BindValue[]): Promise<Row[]> {
      try {
        const [rows] = await getPool().query(sql, params as BindValue[]);
        return rows as Row[];
      } catch (error) {
        throw mapMysqlError(error);
      }
    },

    async execute(sql: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      try {
        const [result] = await getPool().execute<ResultSetHeader>(sql, params as BindValue[]);
        return { insertId: result.insertId, affectedRows: result.affectedRows };
      } catch (error) {
        throw mapMysqlError(error);
      }
    },

    async close(): Promise<void> {
      await closePool();
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await closePool();
    },

    async beginTransaction(): Promise<TxConnection> {
      const conn = await getPool().getConnection();
      try {
        await conn.beginTransaction();
      } catch (error) {
        conn.release();
        throw mapMysqlError(error);
      }
      return {
        dialect: mysqlDialect,

        async query<Row>(sql: string, params: readonly BindValue[]): Promise<Row[]> {
          try {
            const [rows] = await conn.query(sql, params as BindValue[]);
            return rows as Row[];
          } catch (error) {
            throw mapMysqlError(error);
          }
        },

        async execute(sql: string, params: readonly BindValue[]): Promise<ExecuteResult> {
          try {
            const [result] = await conn.execute<ResultSetHeader>(sql, params as BindValue[]);
            return { insertId: result.insertId, affectedRows: result.affectedRows };
          } catch (error) {
            throw mapMysqlError(error);
          }
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

        async [Symbol.asyncDispose](): Promise<void> {
          conn.release();
        },
      };
    },
  };
}
