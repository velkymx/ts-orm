import { describe, it, expect, afterEach } from 'vitest';
import { create } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { setLogger, resetLogger } from '../src/errors.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true },
  email: { type: 'string', required: true },
});

afterEach(() => resetLogger());

describe('unified error route', () => {
  it('returns a safe message on a real constraint violation, logging detail', async () => {
    const logged: unknown[] = [];
    setLogger((_m, detail) => logged.push(detail));

    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "email" TEXT UNIQUE)',
      [],
    );

    const first = await create(driver, User, { id: 1, email: 'a@b.co' });
    expect(first.success).toBe(true);

    const dup = await create(driver, User, { id: 2, email: 'a@b.co' });
    expect(dup.success).toBe(false);
    if (!dup.success) {
      expect(dup.message).toBe('Record already exists');
      expect(dup.message).not.toMatch(/UNIQUE|constraint|email/i);
    }
    expect(logged).toHaveLength(1);

    await driver.close();
  });
});
