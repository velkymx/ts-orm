import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import {
  hasMany,
  hasOne,
  belongsTo,
  belongsToMany,
  morphMany,
  load,
  loadOne,
  deleteRelated,
} from '../src/relations.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const Author = defineStruct('authors', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});
const Profile = defineStruct('profiles', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  author_id: { type: 'number', required: true },
  bio: { type: 'string' },
});
const Article = defineStruct('articles', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  author_id: { type: 'number', required: true },
  title: { type: 'string', required: true, length: 120 },
});
const Role = defineStruct('roles', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 30 },
});
const AuthorRole = defineStruct('author_role', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  author_id: { type: 'number', required: true },
  role_id: { type: 'number', required: true },
});
const Comment = defineStruct('comments', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  commentable_id: { type: 'number', required: true },
  commentable_type: { type: 'string', required: true, length: 20 },
  body: { type: 'string', required: true, length: 200 },
});

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute('CREATE TABLE "authors" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
  await driver.execute('CREATE TABLE "profiles" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" INTEGER, "bio" TEXT)', []);
  await driver.execute('CREATE TABLE "articles" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" INTEGER, "title" TEXT)', []);
  await driver.execute('CREATE TABLE "roles" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
  await driver.execute('CREATE TABLE "author_role" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" INTEGER, "role_id" INTEGER)', []);
  await driver.execute('CREATE TABLE "comments" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "commentable_id" INTEGER, "commentable_type" TEXT, "body" TEXT)', []);
  await driver.execute('INSERT INTO "authors" ("name") VALUES (?)', ['ada']);
  await driver.execute('INSERT INTO "authors" ("name") VALUES (?)', ['grace']);
  await driver.execute('INSERT INTO "authors" ("name") VALUES (?)', ['alan']);
  await driver.execute('INSERT INTO "profiles" ("author_id", "bio") VALUES (?, ?)', [1, 'first']);
  await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [1, 'notes']);
  await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [1, 'objections']);
  await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [2, 'compiler']);
  await driver.execute('INSERT INTO "roles" ("name") VALUES (?)', ['admin']);
  await driver.execute('INSERT INTO "roles" ("name") VALUES (?)', ['editor']);
  await driver.execute('INSERT INTO "author_role" ("author_id", "role_id") VALUES (?, ?)', [1, 1]);
  await driver.execute('INSERT INTO "author_role" ("author_id", "role_id") VALUES (?, ?)', [1, 2]);
  await driver.execute('INSERT INTO "author_role" ("author_id", "role_id") VALUES (?, ?)', [2, 2]);
  await driver.execute('INSERT INTO "comments" ("commentable_id", "commentable_type", "body") VALUES (?, ?, ?)', [1, 'article', 'great']);
  await driver.execute('INSERT INTO "comments" ("commentable_id", "commentable_type", "body") VALUES (?, ?, ?)', [2, 'article', 'meh']);
  return driver;
}

/** Wrap a driver counting read statements, proving batched (not N+1) loads. */
function counting(base: Driver): { driver: Driver; reads: () => number } {
  let n = 0;
  const driver: Driver = {
    dialect: base.dialect,
    query: async <Row>(sql: string, params: readonly never[]): Promise<Row[]> => {
      n += 1;
      return base.query<Row>(sql, params);
    },
    execute: (sql, params) => base.execute(sql, params),
    close: () => base.close(),
    [Symbol.asyncDispose]: () => base[Symbol.asyncDispose](),
  };
  return { driver, reads: () => n };
}

describe('relations (issue 22)', () => {
  it('hasMany batches parents into one query', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    const parents = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const rel = hasMany(Author, Article, 'author_id');
    const got = await load(driver, rel, parents);
    expect(reads()).toBe(1);
    expect(got.get(1)?.map((a) => a.title)).toEqual(['notes', 'objections']);
    expect(got.get(2)?.map((a) => a.title)).toEqual(['compiler']);
    expect(got.get(3)).toEqual([]);
    await base.close();
  });

  it('hasOne returns the single row or null', async () => {
    const driver = await setup();
    const rel = hasOne(Author, Profile, 'author_id');
    expect((await loadOne(driver, rel, { id: 1 }))?.bio).toBe('first');
    expect(await loadOne(driver, rel, { id: 2 })).toBeNull();
    await driver.close();
  });

  it('loads from hydrated model instances, not just plain rows', async () => {
    const base = await setup();
    const MAuthor = defineModel(base, Author);
    const parents = [await MAuthor.findOrFail(1), await MAuthor.findOrFail(2)];
    const { driver, reads } = counting(base);
    const rel = hasMany(Author, Article, 'author_id');
    const got = await load(driver, rel, parents);
    expect(reads()).toBe(1);
    expect(got.get(1)?.map((a) => a.title)).toEqual(['notes', 'objections']);
    expect(got.get(2)?.map((a) => a.title)).toEqual(['compiler']);
    await base.close();
  });

  it('loadOne reads the key from a model instance', async () => {
    const driver = await setup();
    const MAuthor = defineModel(driver, Author);
    const rel = hasOne(Author, Profile, 'author_id');
    expect((await loadOne(driver, rel, await MAuthor.findOrFail(1)))?.bio).toBe('first');
    await driver.close();
  });

  it('belongsTo batches children into one parent query', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    const rel = belongsTo(Article, Author, 'author_id');
    const got = await load(driver, rel, [{ id: 1, author_id: 1 }, { id: 2, author_id: 2 }, { id: 3, author_id: 9 }]);
    expect(reads()).toBe(1);
    expect(got.get(1)?.[0]?.name).toBe('ada');
    expect(got.get(2)?.[0]?.name).toBe('grace');
    expect(got.get(9)).toBeUndefined();
    await base.close();
  });

  it('belongsToMany resolves through the pivot in two queries', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    const rel = belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id');
    const got = await load(driver, rel, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(reads()).toBe(2);
    expect(got.get(1)?.map((r) => r.name)).toEqual(['admin', 'editor']);
    expect(got.get(2)?.map((r) => r.name)).toEqual(['editor']);
    expect(got.get(3)).toEqual([]);
    await base.close();
  });

  it('belongsToMany skips pivot links whose target is gone', async () => {
    const base = await setup();
    const { driver } = counting(base);
    await driver.execute('INSERT INTO "author_role" ("author_id", "role_id") VALUES (?, ?)', [1, 999]);
    const rel = belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id');
    const got = await load(driver, rel, [{ id: 1 }]);
    expect(got.get(1)?.map((r) => r.name)).toEqual(['admin', 'editor']);
    await base.close();
  });

  it('morphMany scopes by type plus id in one query', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    const rel = morphMany(Article, Comment, 'commentable_id', 'commentable_type', 'article');
    const got = await load(driver, rel, [{ id: 1 }, { id: 2 }]);
    expect(reads()).toBe(1);
    expect(got.get(1)?.map((c) => c.body)).toEqual(['great']);
    expect(got.get(2)?.map((c) => c.body)).toEqual(['meh']);
    await base.close();
  });

  it('chunks large key sets instead of one giant IN list', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [1000, 'bulk']);
    const parents = [{ id: 1 }, { id: 2 }];
    for (let i = 0; i < 600; i += 1) parents.push({ id: 1000 + i });
    const rel = hasMany(Author, Article, 'author_id');
    const got = await load(driver, rel, parents);
    expect(reads()).toBe(2);
    expect(got.get(1)?.map((a) => a.title)).toEqual(['notes', 'objections']);
    expect(got.get(1000)?.map((a) => a.title)).toEqual(['bulk']);
    expect(got.get(1599)).toEqual([]);
    await base.close();
  });

  it('empty parents run zero queries', async () => {
    const base = await setup();
    const { driver, reads } = counting(base);
    expect((await load(driver, hasMany(Author, Article, 'author_id'), [])).size).toBe(0);
    expect(reads()).toBe(0);
    await base.close();
  });

  it('rejects hostile identifiers', async () => {
    const driver = await setup();
    const rel = hasMany(Author, Article, 'author_id; DROP' as never);
    await expect(load(driver, rel, [{ id: 1 }])).rejects.toThrow();
    await driver.close();
  });
});

describe('deleteRelated (issue 70)', () => {
  it('removes hasMany children in one statement', async () => {
    const driver = await setup();
    const n = await deleteRelated(driver, hasMany(Author, Article, 'author_id'), [1]);
    expect(n).toBe(2);
    expect((await load(driver, hasMany(Author, Article, 'author_id'), [{ id: 1 }])).get(1)).toEqual([]);
    await driver.close();
  });

  it('removes morph children for one parent type plus id', async () => {
    const driver = await setup();
    const n = await deleteRelated(driver, morphMany(Article, Comment, 'commentable_id', 'commentable_type', 'article'), [1]);
    expect(n).toBe(1);
    expect((await load(driver, morphMany(Article, Comment, 'commentable_id', 'commentable_type', 'article'), [{ id: 1 }, { id: 2 }])).get(1)).toEqual([]);
    await driver.close();
  });

  it('detaches pivot rows for belongsToMany parents', async () => {
    const driver = await setup();
    const rel = belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id');
    const n = await deleteRelated(driver, rel, [1]);
    expect(n).toBe(2);
    expect((await load(driver, rel, [{ id: 1 }, { id: 2 }])).get(1)).toEqual([]);
    await driver.close();
  });
});
