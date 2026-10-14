import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  created_at: { type: 'datetime' },
  updated_at: { type: 'datetime' },
});

const Bare = defineStruct('bare', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "created_at" TEXT, "updated_at" TEXT)',
    [],
  );
  await driver.execute('CREATE TABLE "bare" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT)', []);
  return driver;
}

function validStamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

describe('timestamps (issue 80)', () => {
  it('sets created_at on create', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {}
    const m = await M.create({ title: 'a' });
    expect(validStamp(m.toRow().created_at)).toBe(true);
    expect(m.toRow().updated_at).toBeUndefined();
    await driver.close();
  });

  it('refreshes updated_at on update, keeps created_at', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {}
    const m = await M.create({ title: 'a' });
    const created = m.toRow().created_at;
    m.fill({ title: 'b' });
    await m.save();
    const row = m.toRow();
    expect(row.created_at).toBe(created);
    expect(validStamp(row.updated_at)).toBe(true);
    const reloaded = (await M.find(1))!;
    expect(reloaded.toRow().updated_at).toBe(row.updated_at);
    await driver.close();
  });

  it('opts out per model', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override timestamps = false;
    }
    const m = await M.create({ title: 'a' });
    expect(m.toRow().created_at).toBeUndefined();
    m.fill({ title: 'b' });
    await m.save();
    expect(m.toRow().updated_at).toBeUndefined();
    await driver.close();
  });

  it('stays silent when the struct has no timestamp columns', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Bare) {}
    const m = await M.create({ title: 'a' });
    expect(m.toRow()).toEqual({ id: 1, title: 'a' });
    await driver.close();
  });

  it('respects an explicit created_at', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {}
    const m = await M.create({ title: 'a', created_at: '2020-01-01 00:00:00' });
    expect(m.toRow().created_at).toBe('2020-01-01 00:00:00');
    await driver.close();
  });

  it('no-op saves touch neither column nor hooks', async () => {
    const driver = await setup();
    let runs = 0;
    class M extends defineModel(driver, Post) {
      static override hooks = {
        updating: () => void (runs += 1),
        updated: () => void (runs += 1),
      };
    }
    await M.create({ title: 'a' });
    const m = (await M.find(1))!;
    const before = m.toRow().updated_at;
    await m.save();
    expect(runs).toBe(0);
    expect((await M.find(1))!.toRow().updated_at).toBe(before ?? null);
    await driver.close();
  });

  it('composes with custom hooks', async () => {
    const driver = await setup();
    const order: string[] = [];
    class M extends defineModel(driver, Post) {
      static override hooks = {
        creating: () => void order.push('custom'),
      };
    }
    const m = await M.create({ title: 'a' });
    expect(order).toEqual(['custom']);
    expect(validStamp(m.toRow().created_at)).toBe(true);
    await driver.close();
  });
});
