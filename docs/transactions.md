# Transactions

A transaction groups several writes so they commit together or not at all. ts-orm offers a callback form for the common case and a manual handle for finer control. Both check out a dedicated connection and always release it.

The examples use two accounts:

```ts
import {
  defineStruct, createSqliteDriver, create, read, transaction,
} from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });

const Account = defineStruct('accounts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  owner: { type: 'string', required: true, length: 50 },
  balance: { type: 'number', required: true },
});
```

## The callback form

`transaction(driver, fn)` runs your function inside a transaction. It commits when the function returns and rolls back if it throws. Your function receives a `tx` connection; use it in place of the driver for every write that should be part of the transaction:

```ts
await transaction(driver, async (tx) => {
  await tx.execute('UPDATE "accounts" SET "balance" = "balance" - 30 WHERE "owner" = ?', ['ada']);
  await tx.execute('UPDATE "accounts" SET "balance" = "balance" + 30 WHERE "owner" = ?', ['grace']);
});
```

Both updates commit together. If either throws, neither is kept:

```ts
await transaction(driver, async (tx) => {
  await tx.execute('UPDATE "accounts" SET "balance" = 0 WHERE "owner" = ?', ['ada']);
  throw new Error('boom');
}).catch(() => {});

// Ada's balance is unchanged; the whole block rolled back.
```

## Running CRUD and models in a transaction

The `tx` connection satisfies the full `Driver` contract, so every CRUD function, query builder, and model method takes it. Pass it where you would pass the driver. Model methods accept it as their last argument:

```ts
await transaction(driver, async (tx) => {
  const { data } = await create(tx, Account, { owner: 'ada', balance: 100 });
  await AppAccount.create({ owner: 'grace', balance: 50 }, tx);
});
```

This is how a multi-model write stays atomic: thread one `tx` through every call in the block.

## How hooks behave in a transaction

Before-hooks run inline, as always. After-hooks (`created`, `updated`, `saved`, and the delete and restore pairs) are held until the outer transaction commits, then delivered in order. A write that rolls back never fires its after-hooks, so an after-hook can assume the write is durable:

```ts
await transaction(driver, async (tx) => {
  await AppUser.create({ name: 'Grace' }, tx);
  // 'saving' and 'creating' have run; 'created' and 'saved' have not.
});
// After commit: 'created' and 'saved' now run.
```

Deferred after-hooks are best-effort: a failure there logs through the error route and never fails the committed write. For crash-durable follow-up work, use an outbox table inside the same transaction rather than an after-hook.

## The manual handle

When you need to decide commit or rollback yourself, `beginTransaction(driver)` returns a handle. Run statements through `handle.tx`, call `commit` or `rollback`, then dispose the handle to release the connection:

```ts
import { beginTransaction } from '@velkymx/ts-orm';

const handle = await beginTransaction(driver);
await handle.tx.execute('UPDATE "accounts" SET "balance" = 71 WHERE "owner" = ?', ['ada']);
await handle.commit();
await handle[Symbol.asyncDispose]();
```

The handle implements `AsyncDisposable`, so `await using` releases it even on a throw and rolls back if you never settled it:

```ts
await using handle = await beginTransaction(driver);
await handle.tx.execute('UPDATE "accounts" SET "balance" = 0 WHERE "owner" = ?', ['ada']);
await handle.commit();
// Leaving the scope releases the connection. Had the commit not run, the
// disposal would roll back first.
```

Prefer `await using` or the callback form over a bare handle. They guarantee the connection returns to the pool in a clean state. A raw sqlite transaction that is never settled or disposed stalls the driver, since no later operation can take the lock.

## Nesting

On pooled drivers there are no savepoints. Each `transaction` call checks out its own independent connection and commits on its own, so do not treat nested calls as a rollback boundary. SQLite is the exception: it nests inner transactions as savepoints, so an inner rollback undoes only the inner work. Keep one transaction per logical unit of work.
