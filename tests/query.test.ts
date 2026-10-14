import { describe, it, expect } from 'vitest';
import { query } from '../src/query.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, mssql, sqlite } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
  role: { type: 'string' },
  vip: { type: 'boolean' },
  created_at: { type: 'datetime' },
});

function fakeDriver(dialect = mysql): Driver {
  return {
    dialect,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
  };
}

describe('query builder operators', () => {
  it('equality shorthand binds value', () => {
    const b = query(fakeDriver(), User).where('age', 18);
    expect(b.toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `age` = ?',
      params: [18],
    });
  });

  it('all comparison operators emit bound params', () => {
    const cases: Array<[string, string]> = [
      ['=', '`age` = ?'],
      ['!=', '`age` != ?'],
      ['<>', '`age` <> ?'],
      ['<', '`age` < ?'],
      ['<=', '`age` <= ?'],
      ['>', '`age` > ?'],
      ['>=', '`age` >= ?'],
    ];
    for (const [op, fragment] of cases) {
      const b = query(fakeDriver(), User).where('age', op as never, 18);
      expect(b.toSQL().sql).toContain(fragment);
      expect(b.toSQL().params).toEqual([18]);
    }
  });

  it('LIKE binds pattern', () => {
    const b = query(fakeDriver(), User).where('name', 'LIKE', '%bob%');
    expect(b.toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `name` LIKE ?',
      params: ['%bob%'],
    });
  });

  it('whereIn expands placeholders, empty IN is always false', () => {
    expect(query(fakeDriver(), User).whereIn('role', ['admin', 'staff']).toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `role` IN (?, ?)',
      params: ['admin', 'staff'],
    });
    expect(query(fakeDriver(), User).whereIn('role', []).toSQL().sql).toContain('1 = 0');
    expect(query(fakeDriver(), User).whereNotIn('role', []).toSQL().sql).toContain('1 = 1');
  });

  it('NOT IN and BETWEEN emit correct SQL', () => {
    expect(query(fakeDriver(), User).whereNotIn('role', ['x']).toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `role` NOT IN (?)',
      params: ['x'],
    });
    expect(query(fakeDriver(), User).whereBetween('age', 18, 65).toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `age` BETWEEN ? AND ?',
      params: [18, 65],
    });
    expect(query(fakeDriver(), User).whereNotBetween('age', 1, 2).toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `age` NOT BETWEEN ? AND ?',
      params: [1, 2],
    });
  });

  it('IS NULL and IS NOT NULL emit no params', () => {
    expect(query(fakeDriver(), User).whereNull('role').toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `role` IS NULL',
      params: [],
    });
    expect(query(fakeDriver(), User).whereNotNull('role').toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `role` IS NOT NULL',
      params: [],
    });
  });
});

describe('query builder boolean grouping', () => {
  it('chains AND and OR', () => {
    const b = query(fakeDriver(), User).where('age', '>=', 18).orWhere('vip', true);
    expect(b.toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `age` >= ? OR `vip` = ?',
      params: [18, true],
    });
  });

  it('nested closures compile to parenthesized groups', () => {
    const b = query(fakeDriver(), User)
      .where('age', '>=', 18)
      .where((q) => q.where('role', 'admin').orWhere('vip', true));
    expect(b.toSQL()).toEqual({
      sql: 'SELECT * FROM `users` WHERE `age` >= ? AND (`role` = ? OR `vip` = ?)',
      params: [18, 'admin', true],
    });
  });

  it('uses dialect placeholders in order across groups', () => {
    const b = query(fakeDriver(postgres), User)
      .where('age', '>=', 18)
      .whereIn('role', ['admin', 'staff']);
    expect(b.toSQL()).toEqual({
      sql: 'SELECT * FROM "users" WHERE "age" >= $1 AND "role" IN ($2, $3)',
      params: [18, 'admin', 'staff'],
    });
    const m = query(fakeDriver(mssql), User).where('age', 1).orWhere('age', 2);
    expect(m.toSQL().sql).toBe('SELECT * FROM [users] WHERE [age] = @p1 OR [age] = @p2');
  });
});

describe('query builder modifiers and terminals', () => {
  it('select, orderBy, limit, offset', () => {
    const b = query(fakeDriver(), User)
      .select('id', 'name')
      .where('age', '>=', 18)
      .orderBy('created_at', 'desc')
      .limit(20)
      .offset(40);
    expect(b.toSQL()).toEqual({
      sql: 'SELECT `id`, `name` FROM `users` WHERE `age` >= ? ORDER BY `created_at` DESC LIMIT 20 OFFSET 40',
      params: [18],
    });
  });

  it('count selects COUNT with same filters', () => {
    const b = query(fakeDriver(), User).where('age', '>=', 18);
    expect(b.toCountSQL()).toEqual({
      sql: 'SELECT COUNT(*) AS `count` FROM `users` WHERE `age` >= ?',
      params: [18],
    });
  });

  it('rejects bad identifiers, binds malicious values', () => {
    expect(() => query(fakeDriver(), User).where('age; DROP TABLE users' as never, 1).toSQL()).toThrow();
    expect(() => query(fakeDriver(), User).orderBy('x y' as never).toSQL()).toThrow();
    const evil = "x' OR '1'='1";
    const b = query(fakeDriver(), User).where('name', evil);
    expect(b.toSQL().params).toEqual([evil]);
    expect(b.toSQL().sql).toContain('`name` = ?');
  });
});

describe('query builder sqlite integration', () => {
  it('get, first, count hit real rows', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER, "role" TEXT, "vip" INTEGER)',
      [],
    );
    await driver.execute('INSERT INTO "users" ("name", "age", "role", "vip") VALUES (?, ?, ?, ?)', [
      'bob',
      30,
      'admin',
      1,
    ]);
    await driver.execute('INSERT INTO "users" ("name", "age", "role", "vip") VALUES (?, ?, ?, ?)', [
      'amy',
      17,
      'staff',
      0,
    ]);
    await driver.execute('INSERT INTO "users" ("name", "age", "role", "vip") VALUES (?, ?, ?, ?)', [
      'cat',
      40,
      'staff',
      0,
    ]);

    const adults = await query(driver, User)
      .where('age', '>=', 18)
      .whereIn('role', ['admin', 'staff'])
      .orderBy('age', 'asc')
      .limit(10)
      .get();
    expect(adults.success).toBe(true);
    if (adults.success) expect(adults.data.map((r) => r.name)).toEqual(['bob', 'cat']);

    const orRow = await query(driver, User)
      .where('age', '<', 18)
      .orWhere('name', 'bob')
      .orderBy('age', 'asc')
      .first();
    expect(orRow.success).toBe(true);

    const n = await query(driver, User).where('age', '>=', 18).count();
    expect(n.success).toBe(true);
    if (n.success) expect(n.data).toBe(2);

    const like = await query(driver, User).where('name', 'LIKE', '%o%').get();
    if (like.success) expect(like.data.map((r) => r.name)).toEqual(['bob']);

    const between = await query(driver, User).whereBetween('age', 18, 35).get();
    if (between.success) expect(between.data.map((r) => r.name)).toEqual(['bob']);

    await driver.close();
  });

  it('uses sqlite dialect placeholders', () => {
    expect(query(fakeDriver(sqlite), User).where('age', 1).toSQL().sql).toBe(
      'SELECT * FROM "users" WHERE "age" = ?',
    );
  });
});
