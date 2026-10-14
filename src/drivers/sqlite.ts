/**
 * SQLite driver built on the built-in node:sqlite module, so SQLite support
 * adds no dependency. The module is synchronous; the calls are wrapped to
 * satisfy the async Driver contract.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqlite as sqliteDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult } from '../driver.js';

export interface SqliteOptions {
  /** Database file path, or ':memory:' for an ephemeral database. */
  readonly filename?: string;
}

export function createSqliteDriver(options: SqliteOptions = {}): Driver {
  const filename = options.filename ?? process.env.DB_FILE ?? ':memory:';
  let db: DatabaseSync | null = null;

  function getDb(): DatabaseSync {
    if (!db) {
      db = new DatabaseSync(filename);
    }
    return db;
  }

  return {
    dialect: sqliteDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      const statement = getDb().prepare(text);
      return statement.all(...(params as SQLInputValue[])) as Row[];
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      const statement = getDb().prepare(text);
      const info = statement.run(...(params as SQLInputValue[]));
      return {
        insertId: Number(info.lastInsertRowid),
        affectedRows: Number(info.changes),
      };
    },

    async close(): Promise<void> {
      if (db) {
        db.close();
        db = null;
      }
    },
  };
}
