import { describe, it, expect } from 'vitest';
import { escapeLike } from '../src/identifiers.js';
import { query } from '../src/query.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, mssql } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

function fakeDriver(dialect = mysql): Driver {
  return {
    dialect,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
  };
}

describe('escapeLike (issue 71)', () => {
  it('escapes percent, underscore, and backslash', () => {
    expect(escapeLike('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('leaves plain text untouched', () => {
    expect(escapeLike('bob')).toBe('bob');
  });

  it('escapes a lone escape character', () => {
    expect(escapeLike('\\')).toBe('\\\\');
  });
});

describe('whereLike (issue 71)', () => {
  it('binds an escaped contains pattern with an explicit ESCAPE', () => {
    const b = query(fakeDriver(), User).whereLike('name', 'b%b_b\\');
    expect(b.toSQL()).toEqual({
      sql: "SELECT * FROM `users` WHERE `name` LIKE ? ESCAPE '\\'",
      params: ['%b\\%b\\_b\\\\%'],
    });
  });

  it('orWhereLike joins with OR', () => {
    const b = query(fakeDriver(), User).where('id', 1).orWhereLike('name', 'x');
    expect(b.toSQL()).toEqual({
      sql: "SELECT * FROM `users` WHERE `id` = ? OR `name` LIKE ? ESCAPE '\\'",
      params: [1, '%x%'],
    });
  });

  it('numbers placeholders per dialect in order', () => {
    const pg = query(fakeDriver(postgres), User).where('id', 1).whereLike('name', 'a%b');
    expect(pg.toSQL()).toEqual({
      sql: `SELECT * FROM "users" WHERE "id" = $1 AND "name" LIKE $2 ESCAPE '\\'`,
      params: [1, '%a\\%b%'],
    });
    const ms = query(fakeDriver(mssql), User).whereLike('name', 'q');
    expect(ms.toSQL().sql).toBe(`SELECT * FROM [users] WHERE [name] LIKE @p1 ESCAPE '\\'`);
  });

  it('still validates the column identifier', () => {
    expect(() => query(fakeDriver(), User).whereLike('n; DROP' as never, 'x').toSQL()).toThrow();
  });

  it('matches a literal percent, not all rows (sqlite integration)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
    await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['100% real']);
    await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['100 percent']);
    await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['other']);
    const hit = await query(driver, User).whereLike('name', '100%').get();
    expect(hit.success).toBe(true);
    if (hit.success) expect(hit.data.map((r) => r.name)).toEqual(['100% real']);
    const raw = await query(driver, User).where('name', 'LIKE', '%100%%%').get();
    if (raw.success) expect(raw.data.length).toBe(2);
    await driver.close();
  });
});
