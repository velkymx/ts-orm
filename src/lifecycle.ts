/**
 * Model persistence lifecycle. Typed hooks run around model writes only;
 * the CRUD functions never dispatch, so bulk and raw paths have explicit
 * no-event semantics. Nothing here opens its own transaction: vetoes throw
 * before any SQL runs, and after-hooks deliver inline on plain drivers or
 * defer to the outer commit inside a caller transaction via afterCommit.
 * Deferred failures are logged, never thrown, so a committed write is
 * never reported as rolled back.
 */

import type { Driver, TxConnection } from './driver.js';
import { logError } from './errors.js';
import type { Fields, RowOf, Struct } from './struct.js';

/** Hook names in execution order per operation. */
export type HookName =
  | 'saving'
  | 'creating'
  | 'created'
  | 'saved'
  | 'updating'
  | 'updated'
  | 'deleted'
  | 'deleting';

/** What a hook observes: current attributes plus the pending change set. */
export interface HookContext<F extends Fields> {
  readonly attributes: RowOf<F>;
  readonly changes: Partial<RowOf<F>>;
}

/** One hook: sync or async, rejection behaves exactly like a throw. */
export type HookFn<F extends Fields> = (ctx: HookContext<F>) => void | Promise<void>;

/** Per-model hook table. Models set this as a static; absent means no hooks. */
export type ModelHooks<F extends Fields> = Partial<Record<HookName, HookFn<F>>>;

/** Run the named hooks in order, awaiting each. A throw vetoes the write. */
export async function runHooks<F extends Fields>(
  hooks: ModelHooks<F> | undefined,
  name: HookName,
  ctx: HookContext<F>,
): Promise<void> {
  const fn = hooks?.[name];
  if (fn) {
    await fn(ctx);
  }
}

/**
 * Current UTC time as `YYYY-MM-DD HH:MM:SS`, matching datetime validation.
 */
export function timestampNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Built-in timestamp hooks for a struct. creating fills created_at when
 * the column exists and no value was given, updating always refreshes
 * updated_at when the column exists. Mutates the live attributes so later
 * validation and change computation observe the stamps.
 */
export function timestampHooks<F extends Fields>(struct: Struct<string, Fields>): ModelHooks<F> {
  const names = Object.keys(struct.fields);
  const created = names.includes('created_at') ? 'created_at' : undefined;
  const updated = names.includes('updated_at') ? 'updated_at' : undefined;
  return {
    creating: (ctx) => {
      if (created) {
        const attributes = ctx.attributes as Record<string, unknown>;
        if (attributes[created] === undefined || attributes[created] === null) {
          attributes[created] = timestampNow();
        }
      }
    },
    updating: (ctx) => {
      if (updated) {
        (ctx.attributes as Record<string, unknown>)[updated] = timestampNow();
      }
    },
  };
}

/** True when the driver is a checked-out transaction connection. */
export function isTransaction(driver: Driver): driver is TxConnection {
  return (
    typeof (driver as Partial<TxConnection>).commit === 'function' &&
    typeof (driver as Partial<TxConnection>).release === 'function'
  );
}

const deferred = new WeakMap<TxConnection, Array<() => Promise<void>>>();
// Keying: each beginTransaction mints a fresh wrapper object, so entries die
// with the wrapper on release even when the pool reuses the raw connection.
// Rollback paths never drain; orphaned entries vanish with their key.

/**
 * Schedule fn after the outer commit, or run it now on a plain driver.
 * Failures are logged, never thrown.
 */
export async function afterCommit(driver: Driver, fn: () => Promise<void>): Promise<void> {
  if (!isTransaction(driver)) {
    await fn();
    return;
  }
  const queue = deferred.get(driver);
  if (queue) {
    queue.push(fn);
  } else {
    deferred.set(driver, [fn]);
  }
}

/** Run queued after-commit work. Failures log through the error route. */
export async function drainAfterCommit(tx: TxConnection): Promise<void> {
  const queue = deferred.get(tx) ?? [];
  deferred.delete(tx);
  for (const fn of queue) {
    try {
      await fn();
    } catch (error) {
      logError('[ts-orm] after-commit listener failed', error);
    }
  }
}

/**
 * Deliver after-hooks: inline on plain drivers, deferred to the outer
 * commit inside a transaction. Failures log, never throw, so a committed
 * write is never reported as failed.
 */
export async function deliver<F extends Fields>(
  driver: Driver,
  hooks: ModelHooks<F> | undefined,
  names: readonly HookName[],
  ctx: HookContext<F>,
): Promise<void> {
  await afterCommit(driver, async () => {
    try {
      for (const name of names) {
        await runHooks(hooks, name, ctx);
      }
    } catch (error) {
      logError('[ts-orm] after hook failed', error);
    }
  });
}
