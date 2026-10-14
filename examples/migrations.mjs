import assert from 'node:assert/strict';
import {
  defineStruct,
  createSqliteDriver,
  structColumns,
  buildCreateTable,
  buildCreateIndex,
  migrate,
  rollback,
} from '../dist/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

const first = {
  name: '20240101000000_create_posts',
  up: async (d) => {
    await d.execute(buildCreateTable(d.dialect, 'posts', structColumns(Post)), []);
    await d.execute(buildCreateIndex(d.dialect, 'posts', ['title'], {}), []);
  },
  down: async (d) => {
    await d.execute('DROP TABLE "posts"', []);
  },
};

const applied = await migrate(driver, [first]);
assert.deepEqual(applied.applied, ['20240101000000_create_posts']);
assert.equal(applied.batch, 1);
console.log('migrated:', applied.applied);

const again = await migrate(driver, [first]);
assert.deepEqual(again.applied, []);
console.log('rerun applies nothing');

await driver.execute('INSERT INTO "posts" ("title") VALUES (?)', ['hello']);
const rows = await driver.query('SELECT * FROM "posts"', []);
assert.equal(rows.length, 1);
console.log('table works:', rows);

const reverted = await rollback(driver, [first]);
assert.deepEqual(reverted.reverted, ['20240101000000_create_posts']);
const rest = await driver.query(
  "SELECT \"name\" FROM \"sqlite_master\" WHERE \"type\" = 'table' AND \"name\" = 'posts'",
  [],
);
assert.equal(rest.length, 0);
console.log('rolled back clean');

await driver.close();
console.log('migrations ok');
