import { describe, it, expect } from 'vitest';
import { query } from '../src/query.js';
import { defineStruct } from '../src/struct.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});

describe('select narrowing (issue 103)', () => {
  it('returns only selected columns at runtime', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
      [],
    );
    await driver.execute('INSERT INTO "users" ("name", "age") VALUES (?, ?)', ['bob', 30]);
    const result = await query(driver, User).select('name').get();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ name: 'bob' }]);
      expect(typeof result.data[0]?.name).toBe('string');
      // @ts-expect-error: age is not part of the selected shape
      expect(result.data[0]?.age).toBeUndefined();
    }
    await driver.close();
  });

  it('keeps narrowing through chained conditions', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
      [],
    );
    const narrowed = query(driver, User).select('name').where('age', '>=', 18);
    const result = await narrowed.first();
    expect(result.success).toBe(true);
    if (result.success && result.data !== null) {
      expect(typeof result.data.name).toBe('string');
      // @ts-expect-error: age is not part of the selected shape
      expect(result.data.age).toBeUndefined();
    }
    await driver.close();
  });
});
