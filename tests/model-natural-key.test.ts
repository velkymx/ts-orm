import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const Doc = defineStruct('docs', {
  id: { type: 'string', required: true, length: 36 },
  title: { type: 'string', required: true, length: 120 },
});

async function setup() {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute('CREATE TABLE "docs" ("id" TEXT PRIMARY KEY, "title" TEXT)', []);
  return driver;
}

describe('natural keys (issue 124)', () => {
  it('keeps a caller-supplied primary key instead of the driver insert id', async () => {
    const driver = await setup();
    const M = defineModel(driver, Doc);
    const doc = await M.create({ id: 'abc-123', title: 'x' });
    expect(doc.toRow().id).toBe('abc-123');
    await driver.close();
  });

  it('round-trips save and delete on the supplied key', async () => {
    const driver = await setup();
    const M = defineModel(driver, Doc);
    const doc = await M.create({ id: 'abc-123', title: 'x' });
    doc.fill({ title: 'y' });
    await doc.save();
    expect((await M.find('abc-123'))?.toRow().title).toBe('y');
    await doc.delete();
    expect(await M.find('abc-123')).toBeNull();
    await driver.close();
  });

  it('still fills auto-increment ids when the caller supplies none', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT)',
      [],
    );
    const Post = defineStruct('posts', {
      id: { type: 'number', required: true, default: 'auto_increment' },
      title: { type: 'string', required: true, length: 120 },
    });
    const M = defineModel(driver, Post);
    const post = await M.create({ title: 'x' });
    expect(post.toRow().id).toBe(1);
    await driver.close();
  });
});
