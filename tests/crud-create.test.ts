import { describe, it, expect } from 'vitest';
import { buildInsert, create } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, sqlite, mssql } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  created_at: { type: 'datetime', default: 'current_timestamp' },
});

describe('buildInsert', () => {
  it('omits auto_increment and unprovided defaults, quotes per dialect', () => {
    expect(buildInsert(mysql, User, { name: 'bob' })).toEqual({
      sql: 'INSERT INTO `users` (`name`) VALUES (?)',
      params: ['bob'],
    });
    expect(buildInsert(sqlite, User, { name: 'bob' })).toEqual({
      sql: 'INSERT INTO "users" ("name") VALUES (?)',
      params: ['bob'],
    });
  });

  it('appends RETURNING for postgres', () => {
    expect(buildInsert(postgres, User, { name: 'bob' })).toEqual({
      sql: 'INSERT INTO "users" ("name") VALUES ($1) RETURNING "id"',
      params: ['bob'],
    });
  });

  it('uses OUTPUT INSERTED and @p markers for mssql', () => {
    expect(buildInsert(mssql, User, { name: 'bob' })).toEqual({
      sql: 'INSERT INTO [users] ([name]) OUTPUT INSERTED.[id] VALUES (@p1)',
      params: ['bob'],
    });
  });

  it('binds multiple columns in declared order', () => {
    const Post = defineStruct('posts', {
      id: { type: 'number', default: 'auto_increment' },
      title: { type: 'string' },
      body: { type: 'string' },
    });
    expect(buildInsert(postgres, Post, { title: 't', body: 'b' })).toEqual({
      sql: 'INSERT INTO "posts" ("title", "body") VALUES ($1, $2) RETURNING "id"',
      params: ['t', 'b'],
    });
  });
});

describe('create (SQLite integration)', () => {
  it('inserts a row, lets the DB fill defaults, and returns the new id', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "created_at" TEXT DEFAULT CURRENT_TIMESTAMP)',
      [],
    );

    const result = await create(driver, User, { name: 'bob' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(1);
    }

    const rows = await driver.query<{ id: number; name: string }>(
      'SELECT id, name FROM "users"',
      [],
    );
    expect(rows).toEqual([{ id: 1, name: 'bob' }]);
    await driver.close();
  });

  it('fails validation when a required field is missing', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    const result = await create(driver, User, {} as { name: string });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain('name is required');
    }
    await driver.close();
  });
});
