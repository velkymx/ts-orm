import { describe, it, expect } from 'vitest';
import { readOne, findOrFail, NotFoundError } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

async function seed(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)',
    [],
  );
  await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['bob']);
  await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['amy']);
  return driver;
}

describe('readOne', () => {
  it('returns the matching row', async () => {
    const driver = await seed();
    const result = await readOne(driver, User, { name: 'bob' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.name).toBe('bob');
    }
    await driver.close();
  });

  it('returns null data when nothing matches', async () => {
    const driver = await seed();
    const result = await readOne(driver, User, { name: 'nobody' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
    await driver.close();
  });
});

describe('findOrFail', () => {
  it('returns the row when found', async () => {
    const driver = await seed();
    const row = await findOrFail(driver, User, 'name', 'amy');
    expect(row.name).toBe('amy');
    await driver.close();
  });

  it('throws NotFoundError when missing', async () => {
    const driver = await seed();
    await expect(findOrFail(driver, User, 'name', 'ghost')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await driver.close();
  });
});
