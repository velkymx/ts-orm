import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { NotFoundError } from '../src/crud.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { hasOne, hasMany, belongsTo, belongsToMany, morphMany, load, loadOne, deleteRelated } from '../src/relations.js';
import { isTrashed } from '../src/soft.js';
import type { Driver } from '../src/driver.js';

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  updated_at: { type: 'datetime' },
  deleted_at: { type: 'datetime' },
});

const Comment = defineStruct('comments', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  post_id: { type: 'number' },
  body: { type: 'string', length: 200 },
  deleted_at: { type: 'datetime' },
});

const Tag = defineStruct('tags', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  label: { type: 'string', length: 60 },
  deleted_at: { type: 'datetime' },
});

const PostTag = defineStruct('post_tags', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  post_id: { type: 'number' },
  tag_id: { type: 'number' },
});

const Attachment = defineStruct('attachments', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  attachable_id: { type: 'number' },
  attachable_type: { type: 'string', length: 60 },
  deleted_at: { type: 'datetime' },
});

const Plain = defineStruct('plains', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

async function setup(): Promise<Driver> {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "updated_at" TEXT, "deleted_at" TEXT)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "comments" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "post_id" INTEGER, "body" TEXT, "deleted_at" TEXT)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "tags" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT, "deleted_at" TEXT)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "post_tags" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "post_id" INTEGER, "tag_id" INTEGER)',
    [],
  );
  await driver.execute(
    'CREATE TABLE "attachments" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "attachable_id" INTEGER, "attachable_type" TEXT, "deleted_at" TEXT)',
    [],
  );
  await driver.execute('CREATE TABLE "plains" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT)', []);
  return driver;
}

function stamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

describe('soft delete basics (issue 82)', () => {
  it('stamps deleted_at and hides the row from direct reads', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    const m = await M.create({ title: 'a' });
    await m.delete();
    expect(stamp(m.toRow().deleted_at)).toBe(true);
    expect(isTrashed(m.toRow() as Record<string, unknown>)).toBe(true);
    expect(await M.find(1)).toBeNull();
    await expect(M.findOrFail(1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await M.all()).toEqual([]);
    await driver.close();
  });

  it('restores through withTrashed with documented repeat behavior', async () => {
    const driver = await setup();
    let hooks = 0;
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
      static override hooks = {
        deleting: () => void (hooks += 1),
        deleted: () => void (hooks += 1),
      };
    }
    const m = await M.create({ title: 'a' });
    await m.delete();
    const first = m.toRow().deleted_at;
    await m.delete();
    expect(hooks).toBe(2);
    expect(m.toRow().deleted_at).toBe(first);
    const found = (await M.withTrashed().find(1))!;
    expect(stamp(found.toRow().deleted_at)).toBe(true);
    await found.restore();
    expect(found.toRow().deleted_at).toBeNull();
    expect((await M.find(1))!.toRow().title).toBe('a');
    await found.restore();
    expect((await M.find(1))!.toRow().title).toBe('a');
    expect((await M.withTrashed().all()).length).toBe(1);
    await driver.close();
  });

  it('force deletes physically and repeats as a silent no-op', async () => {
    const driver = await setup();
    const seen: string[] = [];
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
      static override hooks = {
        forceDeleting: () => void seen.push('forceDeleting'),
        forceDeleted: () => void seen.push('forceDeleted'),
      };
    }
    const m = await M.create({ title: 'a' });
    await m.delete();
    await m.forceDelete();
    expect(seen).toEqual(['forceDeleting', 'forceDeleted']);
    expect(await M.withTrashed().find(1)).toBeNull();
    await m.forceDelete();
    expect(seen).toEqual(['forceDeleting', 'forceDeleted', 'forceDeleting', 'forceDeleted']);
    const raw = await driver.query('SELECT * FROM "posts"', []);
    expect(raw).toEqual([]);
    await driver.close();
  });

  it('keeps non-soft models on physical delete', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Plain) {}
    const m = await M.create({ title: 'a' });
    await m.delete();
    expect(await driver.query('SELECT * FROM "plains"', [])).toEqual([]);
    await driver.close();
  });

  it('throws clearly when the flag is set without the column', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Plain) {
      static override softDeletes = true;
    }
    const m = await M.create({ title: 'a' });
    await expect(m.delete()).rejects.toThrow(/deleted_at/);
    await expect(m.restore()).rejects.toThrow(/deleted_at/);
    await driver.close();
  });

  it('leaves updated_at alone on soft paths', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    const m = await M.create({ title: 'a' });
    const touched = m.toRow().updated_at;
    await m.delete();
    expect(m.toRow().updated_at).toBe(touched);
    await driver.close();
  });

  it('restores respect veto hooks', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
      static override hooks = {
        restoring: () => {
          throw new Error('nope');
        },
      };
    }
    const m = await M.create({ title: 'a' });
    await m.delete();
    await expect(m.restore()).rejects.toThrow('nope');
    expect(stamp((await M.withTrashed().find(1))!.toRow().deleted_at)).toBe(true);
    await driver.close();
  });
});

describe('soft scopes (issue 82)', () => {
  it('hides trashed rows from the query builder unless withTrashed', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    await M.create({ title: 'a' });
    const m = (await M.find(1))!;
    await m.delete();
    const visible = await M.query().get();
    expect(visible.success ? visible.data : null).toEqual([]);
    const trashed = await M.query().withTrashed().get();
    expect(trashed.success ? trashed.data.length : -1).toBe(1);
    const count = await M.query().count();
    expect(count.success ? count.data : -1).toBe(0);
    const full = await M.query().withTrashed().count();
    expect(full.success ? full.data : -1).toBe(1);
    await driver.close();
  });

  it('filters eager loads without touching sibling tables or raw SQL', async () => {
    const driver = await setup();
    class P extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    class C extends defineModel(driver, Comment) {
      static override softDeletes = true;
    }
    const post = await P.create({ title: 'p' });
    const child = await C.create({ post_id: 1, body: 'c' });
    await child.delete();
    const rel = hasMany(Post, Comment, 'post_id');
    const loaded = await load(driver, rel, [post.toRow()]);
    expect(loaded.get(1)).toEqual([]);
    const shown = await load(driver, rel, [post.toRow()], { withTrashed: true });
    expect(shown.get(1)!.length).toBe(1);
    const one = await loadOne(driver, hasOne(Post, Comment, 'post_id'), post.toRow());
    expect(one).toBeNull();
    const oneShown = await loadOne(driver, hasOne(Post, Comment, 'post_id'), post.toRow(), { withTrashed: true });
    expect(oneShown?.body).toBe('c');
    const raw = await driver.query('SELECT * FROM "comments"', []);
    expect(raw.length).toBe(1);
    await driver.close();
  });

  it('filters belongsTo, pivot targets, and morph children', async () => {
    const driver = await setup();
    class P extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    class T extends defineModel(driver, Tag) {
      static override softDeletes = true;
    }
    const post = await P.create({ title: 'p' });
    const tag = await T.create({ label: 't' });
    await driver.execute('INSERT INTO "post_tags" ("post_id", "tag_id") VALUES (?, ?)', [1, 1]);
    await tag.delete();
    const via = await load(driver, belongsToMany(Post, Tag, PostTag, 'post_id', 'tag_id'), [post.toRow()]);
    expect(via.get(1)).toEqual([]);
    const comment = await driver.query('SELECT * FROM "comments"', []);
    expect(comment.length).toBe(0);
    await driver.execute('INSERT INTO "comments" ("post_id", "body") VALUES (?, ?)', [1, 'owned']);
    const ownerRel = belongsTo(Comment, Post, 'post_id');
    const owner = await loadOne(driver, ownerRel, { post_id: 1 });
    expect(owner?.title).toBe('p');
    await post.delete();
    const gone = await loadOne(driver, ownerRel, { post_id: 1 });
    expect(gone).toBeNull();
    const goneShown = await loadOne(driver, ownerRel, { post_id: 1 }, { withTrashed: true });
    expect(goneShown?.title).toBe('p');
    await driver.execute('INSERT INTO "attachments" ("attachable_id", "attachable_type") VALUES (?, ?)', [1, 'post']);
    const morph = await load(driver, morphMany(Post, Attachment, 'attachable_id', 'attachable_type', 'post'), [
      { id: 1 },
    ]);
    expect(morph.get(1)!.length).toBe(1);
    await driver.execute('UPDATE "attachments" SET "deleted_at" = ? WHERE "id" = ?', ['2024-01-01 00:00:00', 1]);
    const hidden = await load(driver, morphMany(Post, Attachment, 'attachable_id', 'attachable_type', 'post'), [
      { id: 1 },
    ]);
    expect(hidden.get(1)).toEqual([]);
    await driver.close();
  });

  it('casts deleted_at through the datetime cast', async () => {
    const driver = await setup();
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
      static override casts = { deleted_at: 'datetime' } as const;
    }
    const m = await M.create({ title: 'a' });
    await m.delete();
    expect(m.toRow().deleted_at).toBeInstanceOf(Date);
    expect(await M.find(1)).toBeNull();
    const found = (await M.withTrashed().find(1))!;
    expect(found.toRow().deleted_at).toBeInstanceOf(Date);
    await found.restore();
    expect(found.toRow().deleted_at).toBeNull();
    await driver.close();
  });
});

describe('soft children contract (issue 82)', () => {
  it('soft mode stamps children, force removes them, ignore leaves them', async () => {
    const driver = await setup();
    class P extends defineModel(driver, Post) {
      static override softDeletes = true;
    }
    await P.create({ title: 'p' });
    const rel = hasMany(Post, Comment, 'post_id');
    await driver.execute('INSERT INTO "comments" ("post_id", "body") VALUES (?, ?)', [1, 'a']);
    await driver.execute('INSERT INTO "comments" ("post_id", "body") VALUES (?, ?)', [1, 'b']);
    expect(await deleteRelated(driver, rel, [1], 'ignore')).toBe(0);
    expect(await driver.query('SELECT * FROM "comments"', [])).toHaveLength(2);
    expect(await deleteRelated(driver, rel, [1], 'soft')).toBe(2);
    const rows = (await driver.query('SELECT * FROM "comments"', [])) as Record<string, unknown>[];
    expect(rows.every((r) => stamp(r['deleted_at']))).toBe(true);
    expect(await deleteRelated(driver, rel, [1], 'force')).toBe(2);
    expect(await driver.query('SELECT * FROM "comments"', [])).toHaveLength(0);
    await driver.execute('INSERT INTO "comments" ("post_id", "body") VALUES (?, ?)', [1, 'c']);
    expect(await deleteRelated(driver, rel, [1], 'force')).toBe(1);
    expect(await driver.query('SELECT * FROM "comments"', [])).toHaveLength(0);
    await driver.close();
  });

  it('soft bulk deleteWhere stamps matches and skips trashed without hooks', async () => {
    const driver = await setup();
    let hooks = 0;
    class M extends defineModel(driver, Post) {
      static override softDeletes = true;
      static override hooks = {
        deleting: () => void (hooks += 1),
        deleted: () => void (hooks += 1),
      };
    }
    await M.create({ title: 'a' });
    await M.create({ title: 'a' });
    expect((await M.deleteWhere({ title: 'a' })).affectedRows).toBe(2);
    expect(hooks).toBe(0);
    expect(await M.all()).toEqual([]);
    expect((await M.deleteWhere({ title: 'a' })).affectedRows).toBe(0);
    expect((await M.withTrashed().all()).length).toBe(2);
    await driver.close();
  });
});
