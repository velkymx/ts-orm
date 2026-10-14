import { describe, it, expect } from 'vitest';
import type { BindValue, Driver, TxConnection } from '../src/driver.js';
import { sqlite } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { createMysqlDriver } from '../src/drivers/mysql.js';
import { createPostgresDriver } from '../src/drivers/postgres.js';
import { createMssqlDriver } from '../src/drivers/mssql.js';
import { beginTransaction } from '../src/transaction.js';

function stubDriver(onClose: () => void): Driver {
  return {
    dialect: sqlite,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => void onClose(),
    [Symbol.asyncDispose]: async () => void onClose(),
  };
}

function stubTx(hooks: { rolledBack: () => void; released: () => void }): TxConnection {
  return {
    dialect: sqlite,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
    commit: async () => {},
    rollback: async () => void hooks.rolledBack(),
    release: async () => void hooks.released(),
    [Symbol.asyncDispose]: async () => void hooks.released(),
  };
}

describe('driver disposables (issue 30)', () => {
  it('closes the driver when an await using scope exits on throw', async () => {
    let closes = 0;
    const driver = stubDriver(() => void (closes += 1));
    await expect(
      (async () => {
        await using _scope = driver;
        throw new Error('scope boom');
      })(),
    ).rejects.toThrow('scope boom');
    expect(closes).toBe(1);
  });

  it('supports await using over a real sqlite driver', async () => {
    let rows: unknown[] = [];
    {
      await using driver = createSqliteDriver({ filename: ':memory:' });
      await driver.execute('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "n" INTEGER)', []);
      await driver.execute('INSERT INTO "t" ("n") VALUES (?)', [7]);
      rows = await driver.query('SELECT * FROM "t"', []);
    }
    expect(rows).toHaveLength(1);
  });

  it('rolls back and releases a handle when its scope throws', async () => {
    let rolledBack = 0;
    let released = 0;
    const tx = stubTx({ rolledBack: () => void (rolledBack += 1), released: () => void (released += 1) });
    const driver: Driver = {
      dialect: sqlite,
      query: async <Row>(): Promise<Row[]> => [],
      execute: async () => ({ affectedRows: 0 }),
      close: async () => {},
      beginTransaction: async () => tx,
      [Symbol.asyncDispose]: async () => {},
    };
    await expect(
      (async () => {
        await using handle = await beginTransaction(driver);
        await handle.tx.execute('INSERT INTO "t" ("n") VALUES (?)', [1] as BindValue[]);
        throw new Error('tx boom');
      })(),
    ).rejects.toThrow('tx boom');
    expect(rolledBack).toBe(1);
    expect(released).toBe(1);
  });

  it('disposes unconnected pool drivers without opening anything', async () => {
    for (const driver of [createMysqlDriver(), createPostgresDriver(), createMssqlDriver()]) {
      await (driver as Driver)[Symbol.asyncDispose]();
    }
  });
});
