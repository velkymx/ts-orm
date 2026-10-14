import { describe, it, expect } from 'vitest';
import { buildUpdate, buildDelete, update, remove } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});

describe('buildUpdate', () => {
  it('sets supplied columns and filters on the id, dialect-quoted', () => {
    expect(buildUpdate(mysql, User, { id: 1, name: 'x', age: 2 }, 'id')).toEqual({
      sql: 'UPDATE `users` SET `name` = ?, `age` = ? WHERE `id` = ?',
      params: ['x', 2, 1],
    });
    expect(buildUpdate(postgres, User, { id: 1, name: 'x' }, 'id')).toEqual({
      sql: 'UPDATE "users" SET "name" = $1 WHERE "id" = $2',
      params: ['x', 1],
    });
  });

  it('throws on empty column sets instead of emitting SET WHERE', () => {
    expect(() => buildUpdate(mysql, User, { id: 1 }, 'id')).toThrow(/at least one column/i);
  });
});

describe('buildDelete', () => {
  it('deletes by id column, dialect-quoted', () => {
    expect(buildDelete(mysql, User, 'id')).toBe('DELETE FROM `users` WHERE `id` = ?');
    expect(buildDelete(postgres, User, 'id')).toBe('DELETE FROM "users" WHERE "id" = $1');
  });
});

async function seed(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
    [],
  );
  await driver.execute('INSERT INTO "users" ("name", "age") VALUES (?, ?)', ['bob', 30]);
  return driver;
}

describe('update (SQLite integration)', () => {
  it('updates only the supplied columns', async () => {
    const driver = await seed();
    const result = await update(driver, User, { id: 1, age: 31 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.affectedRows).toBe(1);

    const rows = await driver.query<{ name: string; age: number }>('SELECT name, age FROM "users"', []);
    expect(rows[0]).toEqual({ name: 'bob', age: 31 });
    await driver.close();
  });

  it('fails when no updatable fields are provided', async () => {
    const driver = await seed();
    const result = await update(driver, User, { id: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/no fields/i);
    await driver.close();
  });
});

describe('remove (SQLite integration)', () => {
  it('deletes the row by id', async () => {
    const driver = await seed();
    const result = await remove(driver, User, 'id', 1);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.affectedRows).toBe(1);

    const rows = await driver.query('SELECT * FROM "users"', []);
    expect(rows).toHaveLength(0);
    await driver.close();
  });

  it('fails when the id value is missing', async () => {
    const driver = await seed();
    const result = await remove(driver, User, 'id', null);
    expect(result.success).toBe(false);
    await driver.close();
  });
});
