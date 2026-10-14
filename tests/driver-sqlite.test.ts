import { describe, it, expect } from 'vitest';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { sqlite } from '../src/dialect.js';

describe('sqlite driver', () => {
  it('exposes the sqlite dialect and the driver methods', () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    expect(driver.dialect).toBe(sqlite);
    expect(typeof driver.query).toBe('function');
    expect(typeof driver.execute).toBe('function');
    expect(typeof driver.close).toBe('function');
  });

  it('runs create, insert, and select against an in-memory database', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });

    await driver.execute(
      'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)',
      [],
    );

    const inserted = await driver.execute('INSERT INTO t (name) VALUES (?)', ['alice']);
    expect(inserted.insertId).toBe(1);
    expect(inserted.affectedRows).toBe(1);

    const rows = await driver.query<{ id: number; name: string }>(
      'SELECT id, name FROM t',
      [],
    );
    expect(rows).toEqual([{ id: 1, name: 'alice' }]);

    await driver.close();
  });

  it('closes cleanly when no database has been opened', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
