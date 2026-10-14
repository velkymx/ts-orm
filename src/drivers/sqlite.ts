/**
 * SQLite driver built on the built-in node:sqlite module, so SQLite support
 * adds no dependency. The module is synchronous; the calls are wrapped to
 * satisfy the async Driver contract.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqlite as sqliteDialect } from '../dialect.js';
import type { BindValue, Driver, ExecuteResult, TxConnection } from '../driver.js';
import { OrmError, type OrmErrorCode } from '../errors.js';
import { txScope } from '../transaction.js';

export interface SqliteOptions {
  /** Database file path, or ':memory:' for an ephemeral database. */
  readonly filename?: string;
}

/** Normalize a node:sqlite error by its constraint message into an OrmError. */
export function mapSqliteError(error: unknown): OrmError {
  const message = error instanceof Error ? error.message : String(error);
  let code: OrmErrorCode = 'unknown';
  if (message.includes('UNIQUE constraint failed')) code = 'duplicate';
  else if (message.includes('FOREIGN KEY constraint failed')) code = 'foreign_key';
  else if (message.includes('NOT NULL constraint failed')) code = 'not_null';
  return new OrmError(code, error);
}

export function createSqliteDriver(options: SqliteOptions = {}): Driver {
  const filename = options.filename ?? process.env.DB_FILE ?? ':memory:';
  let db: DatabaseSync | null = null;

  // One shared handle means one writer: a FIFO mutex serializes top-level
  // transactions and keeps ordinary operations out of an open one. Calls
  // made inside their own transaction (seen via txScope) skip the lock and
  // join it, so reentrant use neither hangs nor escapes. Nested begins
  // become savepoints instead of conflicting BEGINs.
  let locked = false;
  const waiters: Array<() => void> = [];
  const openTx = new Set<TxConnection>();
  let savepoints = 0;

  function acquire(): Promise<void> {
    if (!locked) {
      locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(() => {
        locked = true;
        resolve();
      });
    });
  }

  function releaseLock(): void {
    const next = waiters.shift();
    if (next) next();
    else locked = false;
  }

  /** True when the caller runs inside this driver's own open transaction. */
  function isReentrant(): boolean {
    const current = txScope.getStore();
    return current !== undefined && openTx.has(current);
  }

  async function guarded<T>(work: () => T): Promise<T> {
    const reentrant = isReentrant();
    if (!reentrant) await acquire();
    try {
      return work();
    } finally {
      if (!reentrant) releaseLock();
    }
  }

  function getDb(): DatabaseSync {
    if (!db) {
      db = new DatabaseSync(filename);
    }
    return db;
  }

  async function close(): Promise<void> {
    if (db) {
      db.close();
      db = null;
    }
  }

  return {
    dialect: sqliteDialect,

    async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
      return guarded(() => {
        try {
          const statement = getDb().prepare(text);
          return statement.all(...(params as SQLInputValue[])) as Row[];
        } catch (error) {
          throw mapSqliteError(error);
        }
      });
    },

    async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
      return guarded(() => {
        try {
          const statement = getDb().prepare(text);
          const info = statement.run(...(params as SQLInputValue[]));
          return {
            insertId: Number(info.lastInsertRowid),
            affectedRows: Number(info.changes),
          };
        } catch (error) {
          throw mapSqliteError(error);
        }
      });
    },

    close,

    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },

    async beginTransaction(): Promise<TxConnection> {
      const handle = getDb();
      // Nested begins inside our own transaction become savepoints, with
      // counter-suffixed names that carry no user input.
      const savepoint = isReentrant() ? `tsorm_sp_${(savepoints += 1)}` : null;
      if (savepoint) {
        handle.exec(`SAVEPOINT "${savepoint}"`);
      } else {
        await acquire();
        handle.exec('BEGIN IMMEDIATE');
      }
      let done = false;
      let holding = savepoint === null;
      const tx: TxConnection = {
        dialect: sqliteDialect,

        async query<Row>(text: string, params: readonly BindValue[]): Promise<Row[]> {
          try {
            const statement = handle.prepare(text);
            return statement.all(...(params as SQLInputValue[])) as Row[];
          } catch (error) {
            throw mapSqliteError(error);
          }
        },

        async execute(text: string, params: readonly BindValue[]): Promise<ExecuteResult> {
          try {
            const statement = handle.prepare(text);
            const info = statement.run(...(params as SQLInputValue[]));
            return {
              insertId: Number(info.lastInsertRowid),
              affectedRows: Number(info.changes),
            };
          } catch (error) {
            throw mapSqliteError(error);
          }
        },

        async close(): Promise<void> {},

        async [Symbol.asyncDispose](): Promise<void> {
          settleRollback();
          unlock();
        },

        async commit(): Promise<void> {
          if (!done) {
            handle.exec(savepoint ? `RELEASE "${savepoint}"` : 'COMMIT');
            done = true;
          }
          unlock();
        },

        async rollback(): Promise<void> {
          settleRollback();
          unlock();
        },

        async release(): Promise<void> {
          unlock();
        },
      };
      openTx.add(tx);
      return tx;

      /** Roll back unless already settled. Shared by rollback and dispose. */
      function settleRollback(): void {
        if (!done) {
          handle.exec(savepoint ? `ROLLBACK TO "${savepoint}"` : 'ROLLBACK');
          if (savepoint) handle.exec(`RELEASE "${savepoint}"`);
          done = true;
        }
      }

      function unlock(): void {
        openTx.delete(tx);
        if (holding) {
          holding = false;
          releaseLock();
        }
      }
    },
  };
}
