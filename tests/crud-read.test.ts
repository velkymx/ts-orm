import { describe, it, expect } from 'vitest';
import { buildSelect, read } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, mssql } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});

describe('buildSelect', () => {
  it('selects all with no conditions', () => {
    expect(buildSelect(mysql, User, {}, {})).toEqual({
      sql: 'SELECT * FROM `users`',
      params: [],
    });
  });

  it('renders AND-equality conditions with dialect placeholders', () => {
    expect(buildSelect(postgres, User, { name: 'bob', age: 30 }, {})).toEqual({
      sql: 'SELECT * FROM "users" WHERE "name" = $1 AND "age" = $2',
      params: ['bob', 30],
    });
  });

  it('renders ORDER BY with direction and LIMIT/OFFSET', () => {
    expect(
      buildSelect(mysql, User, {}, { orderBy: 'age', direction: 'desc', limit: 10, offset: 20 }),
    ).toEqual({
      sql: 'SELECT * FROM `users` ORDER BY `age` DESC LIMIT 10 OFFSET 20',
      params: [],
    });
  });

  it('drops OFFSET when no LIMIT is given (fix #8)', () => {
    expect(buildSelect(mysql, User, {}, { offset: 20 })).toEqual({
      sql: 'SELECT * FROM `users`',
      params: [],
    });
  });

  it('ignores a non-numeric limit (fix #13)', () => {
    expect(
      buildSelect(mysql, User, {}, { limit: 'abc' as unknown as number }),
    ).toEqual({ sql: 'SELECT * FROM `users`', params: [] });
  });

  it('adds an ORDER BY fallback for MSSQL pagination', () => {
    expect(buildSelect(mssql, User, {}, { limit: 5 })).toEqual({
      sql: 'SELECT * FROM [users] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
      params: [],
    });
  });
});

describe('read (SQLite integration)', () => {
  it('filters, orders, and limits real rows', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
      [],
    );
    await driver.execute('INSERT INTO "users" ("name", "age") VALUES (?, ?)', ['bob', 30]);
    await driver.execute('INSERT INTO "users" ("name", "age") VALUES (?, ?)', ['amy', 25]);
    await driver.execute('INSERT INTO "users" ("name", "age") VALUES (?, ?)', ['cat', 40]);

    const all = await read(driver, User, {}, { orderBy: 'age', direction: 'asc' });
    expect(all.success).toBe(true);
    if (all.success) {
      expect(all.data.map((r) => r.name)).toEqual(['amy', 'bob', 'cat']);
    }

    const filtered = await read(driver, User, { name: 'bob' }, {});
    expect(filtered.success).toBe(true);
    if (filtered.success) {
      expect(filtered.data).toHaveLength(1);
      expect(filtered.data[0]!.age).toBe(30);
    }

    const limited = await read(driver, User, {}, { orderBy: 'age', direction: 'desc', limit: 1 });
    if (limited.success) {
      expect(limited.data[0]!.name).toBe('cat');
    }

    await driver.close();
  });
});
