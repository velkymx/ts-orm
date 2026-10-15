import assert from 'node:assert/strict';
import {
  defineStruct,
  createSqliteDriver,
  hasMany,
  belongsToMany,
  load,
  deleteRelated,
} from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Author = defineStruct('authors', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
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

await driver.execute('CREATE TABLE "authors" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
await driver.execute('CREATE TABLE "articles" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" INTEGER, "title" TEXT)', []);
await driver.execute('CREATE TABLE "roles" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
await driver.execute('CREATE TABLE "author_role" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" INTEGER, "role_id" INTEGER)', []);
await driver.execute('INSERT INTO "authors" ("name") VALUES (?)', ['ada']);
await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [1, 'notes']);
await driver.execute('INSERT INTO "articles" ("author_id", "title") VALUES (?, ?)', [1, 'objections']);
await driver.execute('INSERT INTO "roles" ("name") VALUES (?)', ['admin']);
await driver.execute('INSERT INTO "author_role" ("author_id", "role_id") VALUES (?, ?)', [1, 1]);

const articles = await load(driver, hasMany(Author, Article, 'author_id'), [{ id: 1 }]);
console.log('articles:', articles.get(1).map((a) => a.title));
assert.deepEqual(articles.get(1).map((a) => a.title), ['notes', 'objections']);

const roles = await load(
  driver,
  belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id'),
  [{ id: 1 }],
);
console.log('roles:', roles.get(1).map((r) => r.name));

const detached = await deleteRelated(
  driver,
  belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id'),
  [1],
);
console.log('detached pivot rows:', detached);
assert.equal(detached, 1);

await driver.close();
console.log('relations ok');
