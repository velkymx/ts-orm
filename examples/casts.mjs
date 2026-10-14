import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, defineModel } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Item = defineStruct('items', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  active: { type: 'number' },
  count: { type: 'number' },
  meta: { type: 'string' },
  seen_at: { type: 'string' },
});

await driver.execute(
  'CREATE TABLE "items" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "active" INTEGER, "count" INTEGER, "meta" TEXT, "seen_at" TEXT)',
  [],
);

class AppItem extends defineModel(driver, Item) {
  static casts = { active: 'boolean', count: 'integer', meta: 'json', seen_at: 'datetime' };
}

const made = await AppItem.create({
  active: true,
  count: 7,
  meta: { a: [1, 2] },
  seen_at: new Date('2024-05-01T10:00:00Z'),
});
console.log('app shapes:', made.toRow());
assert.equal(made.toRow().active, true);
assert.deepEqual(made.toRow().meta, { a: [1, 2] });
assert.ok(made.toRow().seen_at instanceof Date);

const reloaded = (await AppItem.find(1));
assert.equal(reloaded.toRow().active, true);
assert.equal(reloaded.isDirty(), false);
console.log('reload dirty:', reloaded.isDirty());

reloaded.fill({ active: 1 });
assert.equal(reloaded.isDirty(), false);
console.log('representational equal stays clean');

reloaded.fill({ meta: { a: 2 } });
assert.deepEqual(reloaded.getChanges(), { meta: { a: 2 } });
await reloaded.save();
assert.deepEqual((await AppItem.find(1)).toRow().meta, { a: 2 });
console.log('changed column round-trips');

await driver.close();
console.log('casts ok');
