import assert from 'node:assert/strict';
import {
  defineStruct,
  createSqliteDriver,
  create,
  read,
  readOne,
  update,
  remove,
} from '../dist/index.js';

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

const created = await create(driver, User, { name: 'Ada', age: 36 });
assert.equal(created.success, true);
console.log('created id:', created.data.id);

const bad = await create(driver, User, { age: 3 });
assert.equal(bad.success, false);
console.log('validation errors:', bad.errors);

const all = await read(driver, User, {}, { orderBy: 'age', direction: 'desc' });
console.log('all:', all.data);

const one = await readOne(driver, User, { name: 'Ada' });
console.log('readOne:', one.data);

const updated = await update(driver, User, { id: 1, age: 37 });
console.log('updated rows:', updated.data.affectedRows);

const deleted = await remove(driver, User, 'id', 1);
console.log('deleted rows:', deleted.data.affectedRows);

await driver.close();
console.log('basic-crud ok');
