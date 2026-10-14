/**
 * A database driver: the thin adapter between ts-orm and a client library.
 * The core speaks only this interface, so adding an engine means adding a
 * driver plus its dialect, not touching the query layer.
 */

import type { Dialect } from './dialect.js';

/** A scalar that can be bound to a parameter placeholder. */
export type BindValue = string | number | bigint | boolean | Date | Buffer | null;

/** The outcome of a write, normalized across client libraries. */
export interface ExecuteResult {
  readonly insertId?: number | string;
  readonly affectedRows: number;
}

export interface Driver {
  readonly dialect: Dialect;
  /** Run a read and return the rows. */
  query<Row>(sql: string, params: readonly BindValue[]): Promise<Row[]>;
  /** Run a write and return the normalized result. */
  execute(sql: string, params: readonly BindValue[]): Promise<ExecuteResult>;
  /** Release underlying resources. */
  close(): Promise<void>;
  /** Check out a dedicated connection with an open transaction, when supported. */
  beginTransaction?(): Promise<TxConnection>;
}

/**
 * A dedicated transactional connection. Usable anywhere a Driver fits, plus
 * commit, rollback, and release. Release must run exactly once per checkout,
 * on every path including throw.
 */
export interface TxConnection extends Driver {
  /** Commit the open transaction. */
  commit(): Promise<void>;
  /** Roll back the open transaction. */
  rollback(): Promise<void>;
  /** Return the connection to the pool. Runs after commit or rollback. */
  release(): Promise<void>;
}
