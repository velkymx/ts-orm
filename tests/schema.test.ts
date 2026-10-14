import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, sqlite, mssql } from '../src/dialect.js';
import {
  structColumns,
  buildCreateTable,
  buildAddColumn,
  buildDropColumn,
  buildCreateIndex,
  buildDropIndex,
  buildAddForeignKey,
  type ColumnDef,
} from '../src/schema.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';

const POSTS: Record<string, ColumnDef> = {
  id: { type: 'number', primaryKey: true, autoIncrement: true },
  title: { type: 'string', length: 120, required: true },
  published: { type: 'boolean', required: true, default: false },
  made: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
};

describe('create table (issue 24)', () => {
  it('compiles per dialect with identity strategies', () => {
    expect(buildCreateTable(mysql, 'posts', POSTS)).toBe(
      'CREATE TABLE IF NOT EXISTS `posts` (`id` INT NOT NULL PRIMARY KEY AUTO_INCREMENT, ' +
        '`title` VARCHAR(120) NOT NULL, `published` TINYINT(1) NOT NULL DEFAULT 0, ' +
        '`made` DATETIME DEFAULT CURRENT_TIMESTAMP)',
    );
    expect(buildCreateTable(postgres, 'posts', POSTS)).toBe(
      'CREATE TABLE IF NOT EXISTS "posts" ("id" SERIAL PRIMARY KEY, ' +
        '"title" VARCHAR(120) NOT NULL, "published" BOOLEAN NOT NULL DEFAULT FALSE, ' +
        '"made" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    );
    expect(buildCreateTable(sqlite, 'posts', POSTS)).toBe(
      'CREATE TABLE IF NOT EXISTS "posts" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
        '"title" TEXT NOT NULL, "published" INTEGER NOT NULL DEFAULT 0, ' +
        '"made" TEXT DEFAULT CURRENT_TIMESTAMP)',
    );
    expect(buildCreateTable(mssql, 'posts', POSTS)).toBe(
      'CREATE TABLE IF NOT EXISTS [posts] ([id] INT IDENTITY(1,1) PRIMARY KEY, ' +
        '[title] VARCHAR(120) NOT NULL, [published] BIT NOT NULL DEFAULT 0, ' +
        '[made] DATETIME2 DEFAULT CURRENT_TIMESTAMP)',
    );
  });

  it('renders uuids, enums, dates, and quoted defaults', () => {
    const cols: Record<string, ColumnDef> = {
      uid: { type: 'uuid', required: true },
      role: { type: 'enum', enum: ['a', "b'c"], required: true, default: 'a' },
      born: { type: 'date' },
      nick: { type: 'string', length: 10, default: "o'h" },
    };
    expect(buildCreateTable(mysql, 't', cols)).toBe(
      'CREATE TABLE IF NOT EXISTS `t` (`uid` CHAR(36) NOT NULL, ' +
        "`role` ENUM('a','b''c') NOT NULL DEFAULT 'a', `born` DATE, `nick` VARCHAR(10) DEFAULT 'o''h')",
    );
    expect(buildCreateTable(postgres, 't', cols)).toBe(
      'CREATE TABLE IF NOT EXISTS "t" ("uid" UUID NOT NULL, ' +
        '"role" TEXT NOT NULL DEFAULT \'a\', "born" DATE, "nick" VARCHAR(10) DEFAULT \'o\'\'h\')',
    );
  });

  it('inlines unique and references with delete rules', () => {
    const cols: Record<string, ColumnDef> = {
      id: { type: 'number', primaryKey: true, autoIncrement: true },
      email: { type: 'string', length: 255, required: true, unique: true },
      author_id: { type: 'number', required: true, references: { table: 'authors', column: 'id', onDelete: 'CASCADE' } },
    };
    expect(buildCreateTable(mysql, 'users', cols)).toContain(
      '`email` VARCHAR(255) NOT NULL UNIQUE, `author_id` INT NOT NULL REFERENCES `authors` (`id`) ON DELETE CASCADE',
    );
  });

  it('rejects hostile identifiers and bad rules', () => {
    expect(() => buildCreateTable(mysql, 'x; DROP', POSTS)).toThrow();
    expect(() =>
      buildCreateTable(mysql, 't', { c: { type: 'number', references: { table: 'a', column: 'b', onDelete: 'WIPE' } } }),
    ).toThrow(/onDelete/);
    expect(() => buildCreateTable(mysql, 't', {})).toThrow(/column/);
  });
});

describe('alter and index (issue 24)', () => {
  it('adds and drops columns per dialect', () => {
    const col: ColumnDef = { type: 'string', length: 50, required: true, default: 'hi' };
    expect(buildAddColumn(mysql, 't', 'nick', col)).toBe(
      "ALTER TABLE `t` ADD COLUMN `nick` VARCHAR(50) NOT NULL DEFAULT 'hi'",
    );
    expect(buildAddColumn(mssql, 't', 'nick', col)).toBe(
      "ALTER TABLE [t] ADD [nick] VARCHAR(50) NOT NULL DEFAULT 'hi'",
    );
    expect(buildDropColumn(postgres, 't', 'nick')).toBe('ALTER TABLE "t" DROP COLUMN "nick"');
  });

  it('creates and drops indexes per dialect', () => {
    expect(buildCreateIndex(mysql, 't', ['email'], { unique: true })).toBe(
      'CREATE UNIQUE INDEX `t_email_index` ON `t` (`email`)',
    );
    expect(buildCreateIndex(postgres, 't', ['a', 'b'], {})).toBe(
      'CREATE INDEX "t_a_b_index" ON "t" ("a", "b")',
    );
    expect(buildDropIndex(mysql, 't', 't_email_index')).toBe('DROP INDEX `t_email_index` ON `t`');
    expect(buildDropIndex(sqlite, 't', 't_email_index')).toBe('DROP INDEX IF EXISTS "t_email_index"');
    expect(buildDropIndex(mssql, 't', 'x')).toBe('DROP INDEX [x] ON [t]');
  });

  it('adds foreign keys where engines allow them', () => {
    expect(buildAddForeignKey(postgres, 'c', 'post_id', { table: 'posts', column: 'id' })).toBe(
      'ALTER TABLE "c" ADD CONSTRAINT "c_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id")',
    );
    expect(() =>
      buildAddForeignKey(sqlite, 'c', 'post_id', { table: 'posts', column: 'id' }),
    ).toThrow(/sqlite/i);
  });
});

describe('structColumns (issue 24)', () => {
  it('folds a struct into column definitions', () => {
    const S = defineStruct('posts', {
      id: { type: 'number', required: true, default: 'auto_increment' },
      title: { type: 'string', required: true, length: 120 },
      role: { type: 'enum', enum: ['a', 'b'] as const },
      made: { type: 'datetime', default: 'current_timestamp' },
    });
    expect(structColumns(S)).toEqual({
      id: { type: 'number', required: true, primaryKey: true, autoIncrement: true },
      title: { type: 'string', required: true, length: 120 },
      role: { type: 'enum', required: false, enum: ['a', 'b'] },
      made: { type: 'datetime', required: false, default: 'CURRENT_TIMESTAMP' },
    });
  });
});

describe('schema live on sqlite (issue 24)', () => {
  it('creates, alters, indexes, and drops through the driver', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(buildCreateTable(sqlite, 'posts', POSTS), []);
    await driver.execute("INSERT INTO \"posts\" (\"title\", \"published\") VALUES ('a', 1)", []);
    await driver.execute(buildAddColumn(sqlite, 'posts', 'nick', { type: 'string', length: 20 }), []);
    await driver.execute(buildCreateIndex(sqlite, 'posts', ['title'], {}), []);
    const indexes = await driver.query<Record<string, unknown>>('PRAGMA index_list("posts")', []);
    expect(indexes.length).toBeGreaterThan(0);
    await driver.execute(buildDropIndex(sqlite, 'posts', 'posts_title_index'), []);
    await driver.execute(buildDropColumn(sqlite, 'posts', 'nick'), []);
    const cols = await driver.query<Record<string, unknown>>('PRAGMA table_info("posts")', []);
    expect(cols.map((c) => c['name']).sort()).toEqual(['id', 'made', 'published', 'title']);
    await driver.close();
  });
});
