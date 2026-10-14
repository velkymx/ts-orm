import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, defineModel } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  created_at: { type: 'datetime' },
  updated_at: { type: 'datetime' },
});

await driver.execute(
  'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "created_at" TEXT, "updated_at" TEXT)',
  [],
);

class AppPost extends defineModel(driver, Post) {}

const created = await AppPost.create({ title: 'hello' });
console.log('created_at:', created.toRow().created_at);
assert.match(created.toRow().created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

created.fill({ title: 'hello again' });
await created.save();
console.log('updated_at:', created.toRow().updated_at);
assert.ok(created.toRow().updated_at);

class Bare extends defineModel(driver, Post) {
  static timestamps = false;
}
const bare = await Bare.create({ title: 'plain' });
assert.equal(bare.toRow().created_at, undefined);
console.log('opt-out sets nothing');

await driver.close();
console.log('timestamps ok');
