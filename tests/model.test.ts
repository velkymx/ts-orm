import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { NotFoundError } from '../src/crud.js';
import { transaction } from '../src/transaction.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const UserStruct = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
  email: { type: 'string' },
});

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER, "email" TEXT)',
    [],
  );
  return driver;
}

describe('defineModel (issue 23)', () => {
  it('creates hydrated instances with custom subclass methods', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {
      greeting(): string {
        return `hi ${this.toRow().name as string}`;
      }
    }
    const created = await User.create({ name: 'bob', age: 30 });
    expect(created).toBeInstanceOf(User);
    expect(created.greeting()).toBe('hi bob');
    expect(created.toRow().id).toBe(1);
    await driver.close();
  });

  it('throws on validation failure', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await expect(User.create({ age: 3 } as never)).rejects.toThrow();
    await driver.close();
  });

  it('find returns an instance, null when absent; findOrFail throws', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const found = await User.find(1);
    expect(found?.toRow().name).toBe('bob');
    expect(await User.find(999)).toBeNull();
    await expect(User.findOrFail(999)).rejects.toBeInstanceOf(NotFoundError);
    await driver.close();
  });

  it('all returns hydrated instances', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'a' });
    await User.create({ name: 'b' });
    const all = await User.all();
    expect(all.map((u) => u.toRow().name)).toEqual(['a', 'b']);
    await driver.close();
  });

  it('round-trips fetch, mutate, save with dirty-only writes', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob', age: 30, email: 'b@x.com' });
    const u = (await User.find(1))!;
    expect(u.isDirty()).toBe(false);
    u.fill({ age: 31 });
    expect(u.isDirty()).toBe(true);
    expect(u.isDirty('age')).toBe(true);
    expect(u.isDirty('name')).toBe(false);
    expect(u.getChanges()).toEqual({ age: 31 });
    await u.save();
    expect(u.isDirty()).toBe(false);
    const reloaded = (await User.find(1))!;
    expect(reloaded.toRow()).toMatchObject({ name: 'bob', age: 31, email: 'b@x.com' });
    await driver.close();
  });

  it('save with no changes is a no-op resolving the instance', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const u = (await User.find(1))!;
    await expect(u.save()).resolves.toBe(u);
    await driver.close();
  });

  it('save update validates dirty fields instead of reaching SQL', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const u = (await User.find(1))!;
    u.fill({ name: 'x'.repeat(51) });
    await expect(u.save()).rejects.toThrow(/Validation failed/);
    expect((await User.find(1))?.toRow().name).toBe('bob');
    await driver.close();
  });

  it('save on a new instance inserts and assigns the id', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    const u = new User({ name: 'amy', age: 25 });
    expect(u.isDirty()).toBe(true);
    await u.save();
    expect(u.toRow().id).toBe(1);
    expect(u.isDirty()).toBe(false);
    await driver.close();
  });

  it('delete removes the row; deleting an unsaved instance throws', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const u = (await User.find(1))!;
    await u.delete();
    expect(await User.find(1)).toBeNull();
    await expect(new User({ name: 'x' }).delete()).rejects.toThrow();
    await driver.close();
  });

  it('save on a concurrently removed row surfaces zero instead of throwing', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const u = (await User.find(1))!;
    expect(u.lastAffectedRows).toBeNull();
    await driver.execute('DELETE FROM "users" WHERE "id" = ?', [1]);
    u.fill({ age: 31 });
    await expect(u.save()).resolves.toBe(u);
    expect(u.lastAffectedRows).toBe(0);
    await driver.close();
  });

  it('delete reports the affected rows instead of throwing on a miss', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob' });
    const u = (await User.find(1))!;
    await driver.execute('DELETE FROM "users" WHERE "id" = ?', [1]);
    await expect(u.delete()).resolves.toEqual({ affectedRows: 0 });
    expect(u.lastAffectedRows).toBe(0);
    const v = await User.create({ name: 'amy' });
    await expect(v.delete()).resolves.toEqual({ affectedRows: 1 });
    expect(v.lastAffectedRows).toBe(1);
    await driver.close();
  });

  it('query exposes the fluent builder for raw rows', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await User.create({ name: 'bob', age: 30 });
    await User.create({ name: 'amy', age: 17 });
    const rows = await User.query().where('age', '>=', 18).get();
    expect(rows.success).toBe(true);
    await driver.close();
  });

  it('works inside transactions with commit and rollback', async () => {
    const driver = await setup();
    class User extends defineModel(driver, UserStruct) {}
    await transaction(driver, async (tx) => {
      await User.create({ name: 'a' }, tx);
      await User.create({ name: 'b' }, tx);
    });
    expect((await User.all()).map((u) => u.toRow().name)).toEqual(['a', 'b']);
    await expect(
      transaction(driver, async (tx) => {
        await User.create({ name: 'c' }, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await User.all()).map((u) => u.toRow().name)).toEqual(['a', 'b']);
    await driver.close();
  });
});
