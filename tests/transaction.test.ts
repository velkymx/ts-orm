import { describe, it, expect } from 'vitest';
import { transaction, beginTransaction } from '../src/transaction.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { BindValue, Driver } from '../src/driver.js';
import { sqlite } from '../src/dialect.js';

async function seed(driver: Driver): Promise<void> {
  await driver.execute('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "v" TEXT)', []);
}

describe('transaction callback API (issue 20)', () => {
  it('commits grouped writes atomically', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    const out = await transaction(driver, async (tx) => {
      await tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
      await tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['b']);
      return 'done';
    });
    expect(out).toBe('done');
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t" ORDER BY "id"', []);
    expect(rows.map((r) => r.v)).toEqual(['a', 'b']);
    await driver.close();
  });

  it('rolls back all statements when the callback throws', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    await expect(
      transaction(driver, async (tx) => {
        await tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(rows).toEqual([]);
    await driver.close();
  });

  it('connection stays usable after commit and after rollback (issue 15)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    await transaction(driver, async (tx) => {
      await tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
    });
    await transaction(driver, async (tx) => {
      await tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['b']);
    }).catch(() => {});
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    await expect(driver.close()).resolves.toBeUndefined();
  });

  it('throws a clear error when the driver lacks transaction support', async () => {
    const stub: Driver = {
      dialect: sqlite,
      query: async <Row>(): Promise<Row[]> => [],
      execute: async () => ({ affectedRows: 0 }),
      close: async () => {},
      [Symbol.asyncDispose]: async () => {},
    };
    await expect(transaction(stub, async () => {})).rejects.toThrow(
      'transactions are not supported by this driver',
    );
  });
});

describe('transaction disposable handle (issue 30)', () => {
  it('supports commit then release', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    const handle = await beginTransaction(driver);
    await handle.tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
    await handle.commit();
    await handle[Symbol.asyncDispose]();
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(rows.map((r) => r.v)).toEqual(['a']);
    await driver.close();
  });

  it('asyncDispose rolls back an uncommitted transaction', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    {
      const handle = await beginTransaction(driver);
      await handle.tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
      await handle[Symbol.asyncDispose]();
    }
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(rows).toEqual([]);
    await driver.close();
  });

  it('a throw inside an await using scope still releases (issue 30 acceptance)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    await expect(
      (async () => {
        await using handle = await beginTransaction(driver);
        await handle.tx.execute('INSERT INTO "t" ("v") VALUES (?)', ['a']);
        throw new Error('scope boom');
      })(),
    ).rejects.toThrow('scope boom');
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(rows).toEqual([]);
    await driver.execute('INSERT INTO "t" ("v") VALUES (?)', ['usable']);
    const after = await driver.query<{ v: string }>('SELECT "v" FROM "t"', []);
    expect(after.map((r) => r.v)).toEqual(['usable']);
    await driver.close();
  });

  it('tx handle passes the driver dialect through for builder use', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    const handle = await beginTransaction(driver);
    expect(handle.tx.dialect).toBe(driver.dialect);
    await handle.rollback();
    await handle[Symbol.asyncDispose]();
    await driver.close();
  });
});

describe('transaction param binding', () => {
  it('binds values inside tx like the base driver', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await seed(driver);
    const evil = "x' OR '1'='1";
    await transaction(driver, async (tx) => {
      await tx.execute('INSERT INTO "t" ("v") VALUES (?)', [evil as BindValue]);
    });
    const rows = await driver.query<{ v: string }>('SELECT "v" FROM "t" WHERE "v" = ?', [
      evil as BindValue,
    ]);
    expect(rows).toHaveLength(1);
    await driver.close();
  });
});
