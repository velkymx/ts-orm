import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, defineModel, transaction } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});

await driver.execute(
  'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
  [],
);

class AppUser extends defineModel(driver, User) {
  display() {
    const row = this.toRow();
    return `${row.name} (${row.age})`;
  }
}

const created = await AppUser.create({ name: 'Ada', age: 36 });
console.log('created:', created.display(), 'id', created.toRow().id);

const found = await AppUser.find(created.toRow().id);
found.fill({ age: 37 });
console.log('dirty:', found.isDirty(), 'changes:', found.getChanges());
await found.save();
assert.equal(found.isDirty(), false);

const reloaded = await AppUser.findOrFail(created.toRow().id);
console.log('reloaded:', reloaded.display());

await transaction(driver, async (tx) => {
  await AppUser.create({ name: 'Grace', age: 85 }, tx);
});
console.log('all:', (await AppUser.all()).map((u) => u.display()));

await reloaded.delete();
assert.equal(await AppUser.find(created.toRow().id), null);
console.log('deleted, find returns null');

await driver.close();
console.log('models ok');
