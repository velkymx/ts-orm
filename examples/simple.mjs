import assert from 'node:assert/strict';
import { createSqliteDriver, simpleCreate, simpleReadOne } from '../dist/index.js';

// Load and go: table name plus field array, no struct or model setup.
// Against MySQL the driver argument is omitted entirely and the shared
// pool resolves from the environment; here sqlite is injected so the
// example runs anywhere.
const driver = createSqliteDriver({ filename: ':memory:' });
await driver.execute(
  'CREATE TABLE "users" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT, "created_at" TEXT)',
  [],
);

const userStruct = [
  { name: 'id', type: 'uuid', required: true, length: 36, default: '' },
  { name: 'name', type: 'string', required: true, length: 128, default: '' },
  { name: 'email', type: 'string', required: true, length: 256, default: '' },
  { name: 'created_at', type: 'datetime', required: true, default: 'current_timestamp' },
];

const created = await simpleCreate(
  'users',
  userStruct,
  {
    id: '123e4567-e89b-42d3-a456-426614174000',
    name: 'Bertha',
    email: 'bertha@example.com',
    created_at: '2025-04-07 10:00:00',
  },
  driver,
);
assert.equal(created.success, true);
console.log('created:', created.data);

const missing = await simpleCreate(
  'users',
  userStruct,
  { id: '223e4567-e89b-42d3-a456-426614174000', created_at: '2025-04-07 10:00:00' },
  driver,
);
assert.equal(missing.success, false);
console.log('missing name rejected:', missing.message);

const found = await simpleReadOne('users', { id: '123e4567-e89b-42d3-a456-426614174000' }, driver);
assert.equal(found.success && found.data.name, 'Bertha');
console.log('found:', found.data);

await driver.close();
console.log('simple ok');
