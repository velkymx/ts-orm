import { describe, it, expect, vi } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { create } from '../src/crud.js';
import { transaction } from '../src/transaction.js';
import { afterCommit, isTransaction } from '../src/lifecycle.js';
import type { HookContext } from '../src/lifecycle.js';
import { setLogger } from '../src/errors.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

async function setup(): Promise<Driver> {
  setLogger(() => {});
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
  return driver;
}

describe('lifecycle dispatcher (issue 79)', () => {
  it('runs create hooks in documented order', async () => {
    const driver = await setup();
    const order: string[] = [];
    class M extends defineModel(driver, User) {
      static override hooks = {
        saving: () => void order.push('saving'),
        creating: () => void order.push('creating'),
        created: () => void order.push('created'),
        saved: () => void order.push('saved'),
      };
    }
    await M.create({ name: 'a' });
    expect(order).toEqual(['saving', 'creating', 'created', 'saved']);
    await driver.close();
  });

  it('runs update hooks in documented order with changes', async () => {
    const driver = await setup();
    const seen: unknown[] = [];
    const order: string[] = [];
    class M extends defineModel(driver, User) {
      static override hooks = {
        saving: () => void order.push('saving'),
        updating: (ctx: HookContext<typeof User.fields>) =>
          void (order.push('updating'), seen.push(ctx)),
        updated: () => void order.push('updated'),
        saved: () => void order.push('saved'),
      };
    }
    await M.create({ name: 'a' });
    const m = (await M.find(1))!;
    order.length = 0;
    m.fill({ name: 'b' });
    await m.save();
    expect(order).toEqual(['saving', 'updating', 'updated', 'saved']);
    expect(seen[0]).toMatchObject({ changes: { name: 'b' } });
    await driver.close();
  });

  it('async veto pre-commit prevents the write and leaves state unmarked', async () => {
    const driver = await setup();
    class M extends defineModel(driver, User) {
      static override hooks = {
        creating: async () => {
          throw new Error('vetoed');
        },
      };
    }
    await expect(M.create({ name: 'a' })).rejects.toThrow('vetoed');
    expect((await M.all()).length).toBe(0);
    const m = new M({ name: 'x' });
    await expect(m.save()).rejects.toThrow('vetoed');
    expect(m.isDirty()).toBe(true);
    await driver.close();
  });

  it('delete hooks run around the delete', async () => {
    const driver = await setup();
    const order: string[] = [];
    class M extends defineModel(driver, User) {
      static override hooks = {
        deleting: () => void order.push('deleting'),
        deleted: () => void order.push('deleted'),
      };
    }
    await M.create({ name: 'a' });
    await (await M.find(1))!.delete();
    expect(order).toEqual(['deleting', 'deleted']);
    await driver.close();
  });

  it('no-op save emits no hooks', async () => {
    const driver = await setup();
    const spy = vi.fn();
    class M extends defineModel(driver, User) {
      static override hooks = { saving: spy, updating: spy, updated: spy, saved: spy };
    }
    await M.create({ name: 'a' });
    spy.mockClear();
    await (await M.find(1))!.save();
    expect(spy).not.toHaveBeenCalled();
    await driver.close();
  });

  it('defers after-hooks to the outer commit, skips them on rollback', async () => {
    const driver = await setup();
    const ran: string[] = [];
    class M extends defineModel(driver, User) {
      static override hooks = { created: () => void ran.push('created') };
    }
    await transaction(driver, async (tx) => {
      await M.create({ name: 'a' }, tx);
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['created']);
    await expect(
      transaction(driver, async (tx) => {
        await M.create({ name: 'b' }, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(ran).toEqual(['created']);
    await driver.close();
  });

  it('post-commit listener failure does not fail the write', async () => {
    const driver = await setup();
    class M extends defineModel(driver, User) {
      static override hooks = {
        created: () => {
          throw new Error('listener blew up');
        },
      };
    }
    const m = await M.create({ name: 'a' });
    expect(m.toRow().id).toBe(1);
    expect((await M.all()).length).toBe(1);
    await driver.close();
  });

  it('crud functions dispatch no hooks by contract', async () => {
    const driver = await setup();
    const spy = vi.fn();
    class M extends defineModel(driver, User) {
      static override hooks = { saving: spy, creating: spy, created: spy, saved: spy };
    }
    void M;
    await create(driver, User, { name: 'a' });
    expect(spy).not.toHaveBeenCalled();
    await driver.close();
  });

  it('afterCommit runs inline on plain drivers, detects transactions', async () => {
    const driver = await setup();
    expect(isTransaction(driver)).toBe(false);
    let ran = false;
    await afterCommit(driver, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    await transaction(driver, async (tx) => {
      expect(isTransaction(tx)).toBe(true);
    });
    await driver.close();
  });
});
