import { describe, it, expect } from 'vitest';
import { buildSelectWith, readWith } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { mysql, sqlite } from '../src/dialect.js';
import { query } from '../src/query.js';
import { defineModel } from '../src/model.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  user_id: { type: 'number', required: true },
  title: { type: 'string', required: true, length: 120 },
  status: { type: 'string' },
});


function fakeDriver(dialect = mysql): Driver {
  return {
    dialect,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
}

describe('qualified orderBy in join reads (issue 68)', () => {
  it('compiles ORDER BY posts.id with both halves quoted and no params', () => {
    const built = buildSelectWith(
      mysql,
      Post,
      [{ table: 'users', on: ['posts.user_id', 'users.id'] }],
      { status: 'published' },
      { orderBy: 'posts.id', direction: 'desc' },
    );
    expect(built).toEqual({
      sql: 'SELECT * FROM `posts` INNER JOIN `users` ON `posts`.`user_id` = `users`.`id` WHERE `posts`.`status` = ? ORDER BY `posts`.`id` DESC',
      params: ['published'],
    });
  });

  it('keeps bare orderBy working', () => {
    const built = buildSelectWith(mysql, Post, [], {}, { orderBy: 'id' });
    expect(built.sql).toContain('ORDER BY `id` ASC');
  });

  it('rejects malformed qualifiers', () => {
    expect(() =>
      buildSelectWith(mysql, Post, [], {}, { orderBy: 'posts..id' }),
    ).toThrow();
    expect(() =>
      buildSelectWith(mysql, Post, [], {}, { orderBy: 'posts.id; DROP' }),
    ).toThrow();
  });

  it('returns ordered rows on a real join (sqlite integration)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute('CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER, "title" TEXT, "status" TEXT)', []);
    await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
    await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['b']);
    await driver.execute('INSERT INTO "users" ("name") VALUES (?)', ['a']);
    await driver.execute('INSERT INTO "posts" ("user_id", "title", "status") VALUES (?, ?, ?)', [1, 'one', 'published']);
    await driver.execute('INSERT INTO "posts" ("user_id", "title", "status") VALUES (?, ?, ?)', [2, 'two', 'published']);
    const rows = await readWith<{ title: string }>(
      driver,
      Post,
      [{ table: 'users', on: ['posts.user_id', 'users.id'] }],
      { status: 'published' },
      { orderBy: 'posts.id', direction: 'desc' },
    );
    expect(rows.success).toBe(true);
    if (rows.success) expect(rows.data.map((r) => r.title)).toEqual(['two', 'one']);
    await driver.close();
  });
});

describe('conditional delete (issue 69)', () => {
  it('compiles DELETE from builder conditions with bound params', () => {
    const b = query(fakeDriver(), Post).where('status', 'draft').where('user_id', 7);
    expect(b.toDeleteSQL()).toEqual({
      sql: 'DELETE FROM `posts` WHERE `status` = ? AND `user_id` = ?',
      params: ['draft', 7],
    });
  });

  it('supports OR groups and IN in deletes', () => {
    const b = query(fakeDriver(), Post)
      .where('user_id', 7)
      .orWhere((q) => q.whereIn('status', ['draft', 'archived']).whereNull('title'));
    expect(b.toDeleteSQL().sql).toBe(
      'DELETE FROM `posts` WHERE `user_id` = ? OR (`status` IN (?, ?) AND `title` IS NULL)',
    );
    expect(b.toDeleteSQL().params).toEqual([7, 'draft', 'archived']);
  });

  it('uses dialect placeholders in deletes', () => {
    expect(query(fakeDriver(sqlite), Post).where('id', 1).toDeleteSQL().sql).toBe(
      'DELETE FROM "posts" WHERE "id" = ?',
    );
  });

  it('rejects bad identifier columns, binds hostile values', () => {
    expect(() => query(fakeDriver(), Post).where('s; DROP' as never, 1).toDeleteSQL()).toThrow();
    const evil = "x' OR '1'='1";
    const b = query(fakeDriver(), Post).where('status', evil);
    expect(b.toDeleteSQL().params).toEqual([evil]);
  });

  it('deletes matching rows and reports affectedRows (sqlite integration)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute('CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER, "title" TEXT, "status" TEXT)', []);
    for (const [user_id, title, status] of [[7, 'a', 'draft'], [7, 'b', 'draft'], [7, 'c', 'pub'], [8, 'd', 'draft']] as const) {
      await driver.execute('INSERT INTO "posts" ("user_id", "title", "status") VALUES (?, ?, ?)', [user_id, title, status]);
    }
    const r = await query(driver, Post).where('user_id', 7).where('status', 'draft').delete();
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ affectedRows: 2 });
    const left = await query(driver, Post).orderBy('id', 'asc').get();
    if (left.success) expect(left.data.map((p) => p.title)).toEqual(['c', 'd']);
    await driver.close();
  });

  it('model deleteWhere removes by equality conditions in one statement', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute('CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER, "title" TEXT, "status" TEXT)', []);
    await driver.execute('INSERT INTO "posts" ("user_id", "title", "status") VALUES (?, ?, ?)', [7, 'a', 'draft']);
    await driver.execute('INSERT INTO "posts" ("user_id", "title", "status") VALUES (?, ?, ?)', [7, 'b', 'pub']);
    class MPost extends defineModel(driver, Post) {}
    const r = await MPost.deleteWhere({ user_id: 7, status: 'draft' });
    expect(r).toEqual({ affectedRows: 1 });
    const left = await MPost.all();
    expect(left.map((p) => p.toRow().title)).toEqual(['b']);
    await driver.close();
  });
});
