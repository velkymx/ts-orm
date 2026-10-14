/**
 * Transactions plus disposable cleanup. One driver primitive
 * (beginTransaction) backs two APIs: the callback form that auto commits or
 * rolls back, and the handle form that supports `await using` scopes. The tx
 * connection fits the Driver contract, so CRUD and the query builder run on
 * it unchanged. Raw SQL stays available through tx.query and tx.execute.
 */

import type { Driver, TxConnection } from './driver.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drainAfterCommit } from './lifecycle.js';

/**
 * The transaction enclosing the current execution, if any. Drivers with
 * handle-global resources (sqlite shares one handle) consult it to tell a
 * reentrant call inside their own transaction apart from a concurrent one.
 */
export const txScope: AsyncLocalStorage<TxConnection> = new AsyncLocalStorage<TxConnection>();

/** Thrown when a driver has no transaction support. */
export class TransactionNotSupportedError extends Error {
  constructor() {
    super('transactions are not supported by this driver');
    this.name = 'TransactionNotSupportedError';
  }
}

/**
 * Manual transaction handle. Settles with commit or rollback, then releases.
 * AsyncDisposable rolls back an unsettled transaction, so a throw inside an
 * `await using` scope never leaks the connection.
 */
export class TxHandle {
  readonly tx: TxConnection;
  private settled = false;

  constructor(tx: TxConnection) {
    this.tx = tx;
  }

  /** Commit the transaction, then deliver queued after-commit work. */
  async commit(): Promise<void> {
    await this.tx.commit();
    this.settled = true;
    await drainAfterCommit(this.tx);
  }

  /** Roll back the transaction and mark the handle settled. */
  async rollback(): Promise<void> {
    await this.tx.rollback();
    this.settled = true;
  }

  /** Roll back when unsettled, then always release. Safe to run twice. */
  async [Symbol.asyncDispose](): Promise<void> {
    try {
      if (!this.settled) {
        await this.tx.rollback();
        this.settled = true;
      }
    } finally {
      await this.tx.release();
    }
  }
}

/** Check out a manual handle. Caller must settle and dispose it. */
export async function beginTransaction(driver: Driver): Promise<TxHandle> {
  const begin = driver.beginTransaction;
  if (!begin) {
    throw new TransactionNotSupportedError();
  }
  return new TxHandle(await begin());
}

/**
 * Run fn inside a transaction. Commits on success, rolls back on throw, and
 * always releases through an `await using` handle. Queued after-commit work
 * drains only after the commit succeeds. Each call owns an independent
 * connection: pooled drivers check out independently with no savepoints, so
 * nested calls commit independently there; sqlite nests inner calls as
 * savepoints instead. The original error is preserved when rollback also fails.
 */
export async function transaction<T>(
  driver: Driver,
  fn: (tx: TxConnection) => Promise<T>,
): Promise<T> {
  const begin = driver.beginTransaction;
  if (!begin) {
    throw new TransactionNotSupportedError();
  }
  await using handle = new TxHandle(await begin());
  try {
    const result = await txScope.run(handle.tx, () => fn(handle.tx));
    await handle.commit();
    await drainAfterCommit(handle.tx);
    return result;
  } catch (error) {
    try {
      await handle.rollback();
    } catch {
      // Prefer the original failure over a rollback failure.
    }
    throw error;
  }
}
