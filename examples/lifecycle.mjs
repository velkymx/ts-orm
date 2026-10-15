import assert from 'node:assert/strict';
import {
  defineStruct,
  createSqliteDriver,
  defineModel,
  transaction,
} from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);

const events = [];
class AppUser extends defineModel(driver, User) {
  static hooks = {
    saving: () => void events.push('saving'),
    creating: () => void events.push('creating'),
    created: () => void events.push('created'),
    saved: () => void events.push('saved'),
  };
}

await AppUser.create({ name: 'Ada' });
assert.deepEqual(events, ['saving', 'creating', 'created', 'saved']);
console.log('create order:', events);

events.length = 0;
await transaction(driver, async (tx) => {
  await AppUser.create({ name: 'Grace' }, tx);
  assert.deepEqual(events, ['saving', 'creating']);
});
assert.deepEqual(events, ['saving', 'creating', 'created', 'saved']);
console.log('before inline, after deferred to commit:', events);

await driver.close();
console.log('lifecycle ok');
