/**
 * Strip-types probe: runs real sources with no build step. Any
 * non-erasable construct in this import graph fails the run inside
 * Node's type stripping, which is exactly what issue 31 forbids.
 */
import { defineStruct, createSqliteDriver, defineModel } from '../src/index.js';

const driver = createSqliteDriver({ filename: ':memory:' });

const Author = defineStruct('authors', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

await driver.execute('CREATE TABLE "authors" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);

class AppAuthor extends defineModel(driver, Author) {}

await AppAuthor.create({ name: 'ada' });
const row = (await AppAuthor.find(1))?.toRow() ?? null;
console.log(JSON.stringify(row));
await driver.close();
