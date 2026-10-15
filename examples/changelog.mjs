import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, defineModel, transaction } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

await driver.execute(
  'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT)',
  [],
);

// Changelog keeper with no framework: last-known snapshots pair with
// after-hook payloads to record old plus new values per change.
const entries = [];
const shadow = new Map();

function snapshot(row) {
  return { ...row };
}

function diff(oldRow, newRow) {
  const old = {};
  const next = {};
  for (const key of Object.keys(newRow)) {
    if (!Object.is(oldRow?.[key], newRow[key])) {
      old[key] = oldRow?.[key] ?? null;
      next[key] = newRow[key];
    }
  }
  return { old, next };
}

class AppPost extends defineModel(driver, Post) {
  static hooks = {
    created: (ctx) => {
      const row = snapshot(ctx.attributes);
      shadow.set(row.id, row);
      entries.push({ action: 'created', id: row.id, old: null, new: row });
    },
    updated: (ctx) => {
      const row = snapshot(ctx.attributes);
      const { old, next } = diff(shadow.get(row.id), ctx.changes);
      shadow.set(row.id, row);
      entries.push({ action: 'updated', id: row.id, old, new: next });
    },
    deleted: (ctx) => {
      const row = snapshot(ctx.attributes);
      entries.push({ action: 'deleted', id: row.id, old: row, new: null });
      shadow.delete(row.id);
    },
  };
}

const made = await AppPost.create({ title: 'hello' });
assert.deepEqual(entries, [
  { action: 'created', id: 1, old: null, new: { id: 1, title: 'hello' } },
]);
console.log('create recorded:', entries[0]);

made.fill({ title: 'hello again' });
await made.save();
assert.deepEqual(entries[1], { action: 'updated', id: 1, old: { title: 'hello' }, new: { title: 'hello again' } });
console.log('update recorded with old and new:', entries[1]);

const count = entries.length;
await made.save();
assert.equal(entries.length, count);
console.log('no-op save records nothing');

await transaction(driver, async (tx) => {
  await AppPost.create({ title: 'inside tx' }, tx);
  assert.equal(entries.length, count, 'after-hooks wait for commit');
});
assert.equal(entries.length, count + 1);
assert.equal(entries[count].new.title, 'inside tx');
console.log('post-commit delivery: entry lands on commit, not on write');

await made.delete();
assert.deepEqual(entries.at(-1), {
  action: 'deleted',
  id: 1,
  old: { id: 1, title: 'hello again' },
  new: null,
});
console.log('delete recorded:', entries.at(-1));

// A throwing after-hook must never fail the write it observes.
class LoudPost extends defineModel(driver, Post) {
  static hooks = {
    created: () => {
      throw new Error('listener blew up');
    },
  };
}
const loud = await LoudPost.create({ title: 'loud' });
assert.equal((await LoudPost.find(loud.toRow().id)).toRow().title, 'loud');
console.log('listener failure logged, write still reported as success');

await driver.close();
console.log('changelog ok');
