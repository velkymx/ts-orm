import assert from 'node:assert/strict';
import {
  defineStruct,
  createSqliteDriver,
  create,
  read,
  transaction,
  beginTransaction,
} from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Account = defineStruct('accounts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  owner: { type: 'string', required: true, length: 50 },
  balance: { type: 'number', required: true },
});

await driver.execute(
  'CREATE TABLE "accounts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "owner" TEXT, "balance" INTEGER)',
  [],
);
await create(driver, Account, { owner: 'ada', balance: 100 });
await create(driver, Account, { owner: 'grace', balance: 50 });

// Callback form: both writes commit together.
await transaction(driver, async (tx) => {
  await tx.execute('UPDATE "accounts" SET "balance" = "balance" - 30 WHERE "owner" = ?', ['ada']);
  await tx.execute('UPDATE "accounts" SET "balance" = "balance" + 30 WHERE "owner" = ?', ['grace']);
});
console.log('after transfer:', (await read(driver, Account)).data);

// A throw rolls everything back.
await transaction(driver, async (tx) => {
  await tx.execute('UPDATE "accounts" SET "balance" = 0 WHERE "owner" = ?', ['ada']);
  throw new Error('boom');
}).catch(() => {});
const kept = await read(driver, Account, { owner: 'ada' });
assert.equal(kept.data[0].balance, 70);
console.log('rollback kept balance:', kept.data[0].balance);

// Manual handle: settle explicitly, dispose releases.
const handle = await beginTransaction(driver);
await handle.tx.execute('UPDATE "accounts" SET "balance" = 71 WHERE "owner" = ?', ['ada']);
await handle.commit();
await handle[Symbol.asyncDispose]();
console.log('handle committed:', (await read(driver, Account, { owner: 'ada' })).data[0].balance);

await driver.close();
console.log('transactions ok');
