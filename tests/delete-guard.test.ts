import { describe, it, expect, beforeEach } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { query } from '../src/query.js';
import { buildSoftUpdate } from '../src/crud.js';
import { defineModel } from '../src/model.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { sqlite } from '../src/dialect.js';
import type { Driver } from '../src/driver.js';

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

const SoftPost = defineStruct('soft_posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  deleted_at: { type: 'string' },
});

let driver: Driver;

beforeEach(async () => {
  driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "soft_posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "deleted_at" TEXT)',
    [],
  );
  await driver.execute('INSERT INTO "posts" ("title") VALUES (?)', ['a']);
  await driver.execute('INSERT INTO "posts" ("title") VALUES (?)', ['b']);
  await driver.execute('INSERT INTO "soft_posts" ("title") VALUES (?)', ['a']);
});

describe('unfiltered delete guard (issue 100)', () => {
  it('refuses filterless delete and leaves the table intact', async () => {
    const result = await query(driver, Post).delete();
    expect(result.success).toBe(false);
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "posts"', []);
    expect(rows).toHaveLength(2);
  });

  it('deletes everything through the explicit deleteAll hatch', async () => {
    const result = await query(driver, Post).deleteAll();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affectedRows).toBe(2);
    }
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "posts"', []);
    expect(rows).toHaveLength(0);
  });

  it('keeps filtered deletes working', async () => {
    const result = await query(driver, Post).where('title', 'a').delete();
    expect(result).toEqual({ success: true, message: 'Records deleted', data: { affectedRows: 1 } });
  });

  it('buildSoftUpdate throws on empty filters instead of stamping the table', () => {
    expect(() => buildSoftUpdate(sqlite, SoftPost, 'deleted_at', '2024-01-01 00:00:00', {})).toThrow(
      /filter/i,
    );
  });

  it('Model.deleteWhere with empty conditions refuses on hard tables', async () => {
    const M = defineModel(driver, Post);
    await expect(M.deleteWhere({})).rejects.toThrow(/filter/i);
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "posts"', []);
    expect(rows).toHaveLength(2);
  });

  it('Model.deleteWhere with empty conditions refuses on soft tables', async () => {
    const M = defineModel(driver, SoftPost);
    await expect(M.deleteWhere({})).rejects.toThrow(/filter/i);
    const rows = await driver.query<Record<string, unknown>>(
      'SELECT * FROM "soft_posts" WHERE "deleted_at" IS NULL',
      [],
    );
    expect(rows).toHaveLength(1);
  });
});
