import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, defineModel, hasMany, load, deleteRelated } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  deleted_at: { type: 'datetime' },
});

const Comment = defineStruct('comments', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  post_id: { type: 'number' },
  body: { type: 'string', length: 200 },
  deleted_at: { type: 'datetime' },
});

await driver.execute(
  'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "deleted_at" TEXT)',
  [],
);
await driver.execute(
  'CREATE TABLE "comments" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "post_id" INTEGER, "body" TEXT, "deleted_at" TEXT)',
  [],
);

class AppPost extends defineModel(driver, Post) {
  static softDeletes = true;
}

class AppComment extends defineModel(driver, Comment) {
  static softDeletes = true;
}

const post = await AppPost.create({ title: 'hello' });
await AppComment.create({ post_id: 1, body: 'first' });
await post.delete();
console.log('trashed:', post.toRow().deleted_at);
assert.match(post.toRow().deleted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.equal(await AppPost.find(1), null);
assert.equal((await AppPost.withTrashed().find(1)).toRow().title, 'hello');

const rel = hasMany(Post, Comment, 'post_id');
assert.equal((await load(driver, rel, [{ id: 1 }])).get(1).length, 1);
const kid = (await AppComment.find(1));
await kid.delete();
assert.deepEqual((await load(driver, rel, [{ id: 1 }])).get(1), []);
assert.equal((await load(driver, rel, [{ id: 1 }], { withTrashed: true })).get(1).length, 1);
console.log('relations hide trashed by default');

assert.equal(await deleteRelated(driver, rel, [1], 'ignore'), 0);
await AppComment.create({ post_id: 1, body: 'second' });
assert.equal(await deleteRelated(driver, rel, [1], 'soft'), 1);
console.log('child contract: ignore leaves, soft stamps');

const found = (await AppPost.withTrashed().find(1));
await found.restore();
assert.equal((await AppPost.find(1)).toRow().title, 'hello');
console.log('restored and visible again');

await found.forceDelete();
assert.equal(await AppPost.withTrashed().find(1), null);
console.log('force deleted physically');

await driver.close();
console.log('soft deletes ok');
