import assert from 'node:assert/strict';
import { defineStruct, createSqliteDriver, query } from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
  role: { type: 'string' },
});

await driver.execute(
  'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER, "role" TEXT)',
  [],
);
for (const u of [
  ['bob', 30, 'admin'],
  ['amy', 17, 'staff'],
  ['cat', 40, 'staff'],
  ['hal', 25, 'staff'],
]) {
  await driver.execute('INSERT INTO "users" ("name", "age", "role") VALUES (?, ?, ?)', u);
}

const adults = await query(driver, User)
  .select('id', 'name', 'age')
  .where('age', '>=', 18)
  .whereIn('role', ['admin', 'staff'])
  .orderBy('age', 'desc')
  .get();
console.log('adults:', adults.data.map((r) => r.name));
assert.deepEqual(adults.data.map((r) => r.name), ['cat', 'bob', 'hal']);

const grouped = await query(driver, User)
  .where('age', '<', 18)
  .orWhere((b) => b.where('role', 'admin').where('name', 'LIKE', '%o%'))
  .get();
console.log('grouped:', grouped.data.map((r) => r.name));

const compiled = query(driver, User).whereBetween('age', 18, 35).toSQL();
console.log('compiled:', compiled.sql, JSON.stringify(compiled.params));

const total = await query(driver, User).where('age', '>=', 18).count();
console.log('adult count:', total.data);
assert.equal(total.data, 3);

const first = await query(driver, User).orderBy('age', 'asc').first();
console.log('youngest:', first.data.name);

const gone = await query(driver, User).where('name', 'hal').delete();
console.log('deleted:', gone.data);
assert.equal((await query(driver, User).count()).data, 3);

await driver.close();
console.log('query-builder ok');
