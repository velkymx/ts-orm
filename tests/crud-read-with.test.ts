import { describe, it, expect } from 'vitest';
import { buildSelectWith, readWith } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { mysql } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true },
  status: { type: 'string' },
});

describe('buildSelectWith', () => {
  it('renders an INNER JOIN with qualified ON, dialect-quoted', () => {
    expect(
      buildSelectWith(
        mysql,
        User,
        [{ table: 'posts', on: ['users.id', 'posts.user_id'] }],
        {},
        {},
      ),
    ).toEqual({
      sql: 'SELECT * FROM `users` INNER JOIN `posts` ON `users`.`id` = `posts`.`user_id`',
      params: [],
    });
  });

  it('qualifies WHERE to the main table and binds values', () => {
    expect(
      buildSelectWith(
        mysql,
        User,
        [{ type: 'left', table: 'posts', on: ['users.id', 'posts.user_id'] }],
        { status: 'active' },
        {},
      ),
    ).toEqual({
      sql: 'SELECT * FROM `users` LEFT JOIN `posts` ON `users`.`id` = `posts`.`user_id` WHERE `users`.`status` = ?',
      params: ['active'],
    });
  });

  it('rejects a malformed join condition', () => {
    expect(() =>
      buildSelectWith(mysql, User, [{ table: 'posts', on: ['users.id', 'bad; DROP'] }], {}, {}),
    ).toThrow();
  });
});

describe('readWith (SQLite integration)', () => {
  it('joins two real tables', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT, "status" TEXT)', []);
    await driver.execute('CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY, "user_id" INTEGER, "title" TEXT)', []);
    await driver.execute('INSERT INTO "users" ("id", "name", "status") VALUES (?, ?, ?)', [1, 'bob', 'active']);
    await driver.execute('INSERT INTO "posts" ("id", "user_id", "title") VALUES (?, ?, ?)', [1, 1, 'hello']);

    const result = await readWith<{ name: string; title: string }>(
      driver,
      User,
      [{ table: 'posts', on: ['users.id', 'posts.user_id'] }],
      { status: 'active' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('bob');
      expect(result.data[0]!.title).toBe('hello');
    }
    await driver.close();
  });
});
