import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  defineStruct,
  defineModel,
  createPostgresDriver,
  configurePostgres,
  query,
  transaction,
} from '../src/index.js';
import type { Driver } from '../src/driver.js';

const LIVE = process.env['TS_ORM_TEST_PG'] === '1';

const User = defineStruct('pg_live_users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  email: { type: 'string', length: 120 },
  age: { type: 'number' },
});

const Post = defineStruct('pg_live_posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  user_id: { type: 'number', required: true },
  title: { type: 'string', required: true, length: 120 },
});

let driver: Driver;

async function fresh(): Promise<void> {
  await driver.execute('DROP TABLE IF EXISTS "pg_live_posts"', []);
  await driver.execute('DROP TABLE IF EXISTS "pg_live_users"', []);
  await driver.execute(
    'CREATE TABLE "pg_live_users" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NULL, "age" INTEGER NULL)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "pg_live_posts" ("id" SERIAL PRIMARY KEY, "user_id" INTEGER NOT NULL REFERENCES "pg_live_users"("id"), "title" TEXT NOT NULL)',
    [],
  );
}

describe.runIf(LIVE)('postgres live driver (pg proving)', () => {
  beforeAll(async () => {
    configurePostgres({
      host: process.env['TS_ORM_PG_HOST'] ?? '/tmp',
      user: process.env['TS_ORM_PG_USER'] ?? 'velkymx',
      password: process.env['TS_ORM_PG_PASSWORD'] ?? '',
      database: process.env['TS_ORM_PG_DATABASE'] ?? 'tsorm_pg',
      port: process.env['TS_ORM_PG_PORT'] ? Number(process.env['TS_ORM_PG_PORT']) : 5432,
    });
    driver = createPostgresDriver();
  });

  beforeEach(async () => {
    await fresh();
  });

  afterAll(async () => {
    await driver.execute('DROP TABLE IF EXISTS "pg_live_posts"', []);
    await driver.execute('DROP TABLE IF EXISTS "pg_live_users"', []);
    await driver.close();
  });

  it('round-trips CRUD with RETURNING ids', async () => {
    const M = defineModel(driver, User);
    const u = await M.create({ name: 'ada', age: 36 });
    expect(typeof u.toRow().id).toBe('number');
    expect((await M.find(u.toRow().id))?.toRow().name).toBe('ada');
    u.fill({ age: 37 });
    await u.save();
    expect(u.lastAffectedRows).toBe(1);
    expect((await M.findOrFail(u.toRow().id)).toRow().age).toBe(37);
    expect(await u.delete()).toEqual({ affectedRows: 1 });
    expect(await M.find(u.toRow().id)).toBeNull();
  });

  it('compiles every operator with $N placeholders in order', async () => {
    const M = defineModel(driver, User);
    await M.create({ name: 'a', age: 20 });
    await M.create({ name: 'b', age: 30 });
    const built = query(driver, User)
      .where('age', '>=', 18)
      .where('age', '<', 40)
      .whereIn('name', ['a', 'b'])
      .whereBetween('age', 10, 40)
      .orderBy('age', 'desc')
      .limit(5)
      .offset(0)
      .toSQL();
    expect(built.sql).toContain('$1');
    expect(built.params).toEqual([18, 40, 'a', 'b', 10, 40]);
    const rows = await query(driver, User).where('age', '>=', 18).orderBy('age', 'desc').get();
    expect(rows.success).toBe(true);
  });

  it('runs LIKE with a single-backslash ESCAPE live', async () => {
    const M = defineModel(driver, User);
    await M.create({ name: '100% real' });
    await M.create({ name: '100 percent' });
    const hit = await query(driver, User).whereLike('name', '100%').get();
    expect(hit.success).toBe(true);
    if (hit.success) expect(hit.data.map((r) => r.name)).toEqual(['100% real']);
  });

  it('aggregates and paginates', async () => {
    const M = defineModel(driver, User);
    await M.create({ name: 'x', age: 10 });
    await M.create({ name: 'y', age: 20 });
    const count = await query(driver, User).count();
    expect(count.success && count.data).toBe(2);
    const sum = await query(driver, User).sum('age');
    expect(sum.success && sum.data).toBe(30);
    const page = await query(driver, User).orderBy('id', 'asc').paginate(1, 1);
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(1);
  });

  it('commits and rolls back real transactions', async () => {
    const M = defineModel(driver, User);
    await transaction(driver, async (tx) => {
      await M.create({ name: 'committed' }, tx);
    });
    expect((await query(driver, User).where('name', 'committed').count())).toEqual({ success: true, message: 'Count retrieved', data: 1 });
    await expect(
      transaction(driver, async (tx) => {
        await M.create({ name: 'rolled' }, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await query(driver, User).where('name', 'rolled').count())).toEqual({ success: true, message: 'Count retrieved', data: 0 });
  });

  it('isolates overlapping transactions on separate connections', async () => {
    const M = defineModel(driver, User);
    const tick = () => new Promise((r) => setTimeout(r, 5));
    await Promise.all([
      transaction(driver, async (tx) => {
        await M.create({ name: 'tx-a' }, tx);
        await tick();
      }),
      transaction(driver, async (tx) => {
        await M.create({ name: 'tx-b' }, tx);
        await tick();
      }),
    ]);
    const rows = await query(driver, User).whereIn('name', ['tx-a', 'tx-b']).get();
    expect(rows.success && rows.data).toHaveLength(2);
  });

  it('maps engine errors to safe codes', async () => {
    const M = defineModel(driver, User);
    await M.create({ name: 'dup' });
    const dup = await query(driver, User).where('name', 'other').get();
    expect(dup.success).toBe(true);
    const PM = defineModel(driver, Post);
    await expect(PM.create({ user_id: 99999, title: 'orphan' })).rejects.toThrow();
    try {
      await PM.create({ user_id: 99999, title: 'orphan' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/violates|pg_live_posts| Key \(/i);
      expect((error as Error).message).toMatch(/Related record/i);
    }
  });

  it('loads relations in batched queries', async () => {
    const { hasMany } = await import('../src/relations.js');
    const { load } = await import('../src/relations.js');
    const M = defineModel(driver, User);
    const PM = defineModel(driver, Post);
    const u = await M.create({ name: 'rel' });
    await PM.create({ user_id: u.toRow().id, title: 't1' });
    const got = await load(driver, hasMany(User, Post, 'user_id'), [{ id: u.toRow().id }]);
    expect(got.get(u.toRow().id)?.map((p) => p.title)).toEqual(['t1']);
  });

  it('exposes pg numeric shapes honestly', async () => {
    await driver.execute('DROP TABLE IF EXISTS "pg_live_nums"', []);
    await driver.execute('CREATE TABLE "pg_live_nums" ("n" NUMERIC, "b" BIGINT)', []);
    await driver.execute('INSERT INTO "pg_live_nums" ("n", "b") VALUES (12.5, 9007199254740993)', []);
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "pg_live_nums"', []);
    expect(typeof rows[0]?.['n']).toBe('string');
    expect(typeof rows[0]?.['b']).toBe('string');
    expect(rows[0]?.['b']).toBe('9007199254740993');
    await driver.execute('DROP TABLE "pg_live_nums"', []);
  });

  it('narrows selected columns at runtime and type level', async () => {
    const M = defineModel(driver, User);
    await M.create({ name: 'sel', age: 40 });
    const result = await query(driver, User).select('name').get();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ name: 'sel' }]);
      // @ts-expect-error: age is not part of the selected shape
      expect(result.data[0]?.age).toBeUndefined();
    }
  });

  it('round-trips soft deletes with hooks', async () => {
    const Soft = defineStruct('pg_live_soft', {
      id: { type: 'number', required: true, default: 'auto_increment' },
      name: { type: 'string', required: true, length: 50 },
      deleted_at: { type: 'datetime' },
    });
    await driver.execute('DROP TABLE IF EXISTS "pg_live_soft"', []);
    await driver.execute('CREATE TABLE "pg_live_soft" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "deleted_at" TIMESTAMP NULL)', []);
    const seen: string[] = [];
    class SM extends defineModel(driver, Soft) {
      static override softDeletes = true;
      static override hooks = {
        deleting: () => void seen.push('deleting'),
        deleted: () => void seen.push('deleted'),
      };
    }
    const m = await SM.create({ name: 'softie' });
    await m.delete();
    expect(seen).toEqual(['deleting', 'deleted']);
    expect(await SM.find(m.toRow().id)).toBeNull();
    const trashed = (await SM.withTrashed().find(m.toRow().id))!;
    await trashed.restore();
    expect((await SM.find(m.toRow().id))?.toRow().name).toBe('softie');
    await driver.execute('DROP TABLE "pg_live_soft"', []);
  });
});
