import { describe, it, expect } from 'vitest';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { transaction } from '../src/transaction.js';
import type { Driver } from '../src/driver.js';

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "n" INTEGER)', []);
  return driver;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('sqlite transaction isolation (issue 115)', () => {
  it('keeps independent writes out of an open transaction', async () => {
    const driver = await setup();
    const begin = driver.beginTransaction;
    if (!begin) throw new Error('expected beginTransaction');
    const tx = await begin();
    const pending = driver.execute('INSERT INTO "t" ("n") VALUES (?)', [1]);
    await tick();
    await tx.rollback();
    await tx.release();
    await pending;
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t"', []);
    expect(rows.map((r) => r['n'])).toEqual([1]);
    await driver.close();
  });

  it('serializes overlapping transaction callbacks instead of sharing state', async () => {
    const driver = await setup();
    const run = (base: number) =>
      transaction(driver, async (tx) => {
        for (let i = 0; i < 5; i += 1) {
          await tx.execute('INSERT INTO "t" ("n") VALUES (?)', [base + i]);
          await tick();
        }
      });
    await Promise.all([run(100), run(200)]);
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t" ORDER BY "n"', []);
    expect(rows).toHaveLength(10);
    await driver.close();
  });

  it('lets driver-direct calls inside their own callback join instead of hang', async () => {
    const driver = await setup();
    await transaction(driver, async () => {
      await driver.execute('INSERT INTO "t" ("n") VALUES (?)', [7]);
    });
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t"', []);
    expect(rows.map((r) => r['n'])).toEqual([7]);
    await driver.close();
  });

  it('nests inner transactions as savepoints', async () => {
    const driver = await setup();
    await transaction(driver, async (tx) => {
      await tx.execute('INSERT INTO "t" ("n") VALUES (?)', [1]);
      try {
        await transaction(driver, async (inner) => {
          await inner.execute('INSERT INTO "t" ("n") VALUES (?)', [2]);
          throw new Error('inner boom');
        });
      } catch {
        // Inner rolls back to its savepoint; outer continues.
      }
    });
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t"', []);
    expect(rows.map((r) => r['n'])).toEqual([1]);
    await driver.close();
  });

  it('settles repeated nested transactions without retaining state', async () => {
    const driver = await setup();
    for (let i = 0; i < 50; i += 1) {
      await transaction(driver, async (tx) => {
        await tx.execute('INSERT INTO "t" ("n") VALUES (?)', [i]);
        await transaction(driver, async (inner) => {
          await inner.execute('INSERT INTO "t" ("n") VALUES (?)', [1000 + i]);
        });
      });
    }
    const rows = await driver.query<Record<string, unknown>>('SELECT COUNT(*) AS n FROM "t"', []);
    expect(rows[0]?.['n']).toBe(100);
    await driver.close();
  });

  it('releases the lock when a raw transaction is disposed unsettled', async () => {
    const driver = await setup();
    const begin = driver.beginTransaction;
    if (!begin) throw new Error('expected beginTransaction');
    const tx = await begin();
    await tx.execute('INSERT INTO "t" ("n") VALUES (?)', [1]);
    await tx[Symbol.asyncDispose]();
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t"', []);
    expect(rows).toHaveLength(0);
    await driver.close();
  });
});
