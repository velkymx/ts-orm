import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { castOut, castIn, valuesEqual } from '../src/casts.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const Item = defineStruct('items', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  active: { type: 'number' },
  count: { type: 'number' },
  meta: { type: 'string' },
  seen_at: { type: 'string' },
});

const CASTS = { active: 'boolean', count: 'integer', meta: 'json', seen_at: 'datetime' } as const;

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "items" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "active" INTEGER, "count" INTEGER, "meta" TEXT, "seen_at" TEXT)',
    [],
  );
  return driver;
}

describe('cast pipeline (issue 81)', () => {
  it('casts out on read: integer flags to boolean, text to object and Date', async () => {
    const driver = await setup();
    await driver.execute('INSERT INTO "items" ("active", "count", "meta", "seen_at") VALUES (?, ?, ?, ?)', [
      1,
      '42',
      '{"a":1}',
      '2024-05-01 10:00:00',
    ]);
    const row = { id: 1, active: 1, count: '42', meta: '{"a":1}', seen_at: '2024-05-01 10:00:00' };
    expect(castOut(row, CASTS)).toEqual({
      id: 1,
      active: true,
      count: 42,
      meta: { a: 1 },
      seen_at: new Date('2024-05-01T10:00:00Z'),
    });
    await driver.close();
  });

  it('keeps SQL NULL as null through both directions', () => {
    expect(castOut({ a: null }, { a: 'boolean' })).toEqual({ a: null });
    expect(castIn({ a: null }, { a: 'json' })).toEqual({ a: null });
    expect(castIn({ a: null }, { a: 'datetime' })).toEqual({ a: null });
  });

  it('serializes app values for the database', () => {
    expect(
      castIn(
        { active: true, count: 7, meta: { a: [1, 2] }, seen_at: new Date('2024-05-01T10:00:00Z') },
        CASTS,
      ),
    ).toEqual({ active: 1, count: 7, meta: '{"a":[1,2]}', seen_at: '2024-05-01 10:00:00' });
    expect(castIn({ active: false }, { active: 'boolean' })).toEqual({ active: 0 });
  });

  it('errors loudly on invalid JSON and non-numeric integers', () => {
    expect(() => castOut({ m: '{bad' }, { m: 'json' })).toThrow(/m/);
    expect(() => castIn({ c: 'xx' }, { c: 'integer' })).toThrow(/c/);
    expect(() => castOut({ d: 'not a date' }, { d: 'datetime' })).toThrow(/d/);
  });

  it('compares normalized values for dirtiness', () => {
    expect(valuesEqual(true, 1)).toBe(true);
    expect(valuesEqual({ a: 1 }, '{"a":1}')).toBe(true);
    expect(valuesEqual(new Date('2024-05-01T10:00:00Z'), '2024-05-01 10:00:00')).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual(null, 0)).toBe(false);
  });
});

describe('model casts (issue 81)', () => {
  it('round-trips app values through the database', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Item) {
      static override casts = { ...CASTS };
    }
    const m = await M.create({ active: true as never, count: 7, meta: { a: 1 } as never, seen_at: new Date('2024-05-01T10:00:00Z') as never });
    expect(m.toRow().meta).toEqual({ a: 1 });
    const reloaded = (await M.find(1))!;
    expect(reloaded.toRow().active).toBe(true);
    expect(reloaded.toRow().meta).toEqual({ a: 1 });
    expect(reloaded.toRow().seen_at).toBeInstanceOf(Date);
    expect(reloaded.isDirty()).toBe(false);
    await driver.close();
  });

  it('treats representational equals as clean', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Item) {
      static override casts = { ...CASTS };
    }
    await M.create({ active: true as never, count: 7 });
    const m = (await M.find(1))!;
    m.fill({ active: 1 as never });
    expect(m.isDirty()).toBe(false);
    await m.save();
    expect((await M.find(1))!.toRow().active).toBe(true);
    await driver.close();
  });

  it('writes only changed serialized columns on save', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Item) {
      static override casts = { ...CASTS };
    }
    await M.create({ active: true as never, count: 7, meta: { a: 1 } as never });
    const m = (await M.find(1))!;
    m.fill({ meta: { a: 2 } as never });
    expect(m.getChanges()).toEqual({ meta: { a: 2 } });
    await m.save();
    expect((await M.find(1))!.toRow().meta).toEqual({ a: 2 });
    await driver.close();
  });

  it('leaves cast-free models untouched', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Item) {}
    const m = await M.create({ count: 7 });
    expect(m.toRow().count).toBe(7);
    await driver.close();
  });
});
