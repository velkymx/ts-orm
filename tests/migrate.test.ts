import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';
import { migrate, rollback, trackingSql, type Migration } from '../src/migrate.js';
import { buildCreateTable, buildAddColumn, structColumns } from '../src/schema.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, sqlite, mssql } from '../src/dialect.js';
import { runCli } from '../src/cli.js';

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

function tableMigration(name: string): Migration {
  return {
    name,
    up: async (driver: Driver) => {
      await driver.execute(buildCreateTable(sqlite, 'posts', structColumns(Post)), []);
    },
    down: async (driver: Driver) => {
      await driver.execute('DROP TABLE "posts"', []);
    },
  };
}

async function tables(driver: Driver): Promise<string[]> {
  const rows = await driver.query<Record<string, unknown>>(
    "SELECT \"name\" FROM \"sqlite_master\" WHERE \"type\" = 'table' ORDER BY \"name\"",
    [],
  );
  return rows.map((r) => r['name'] as string);
}

describe('migration runner (issue 24)', () => {
  it('applies pending migrations in order and reruns clean', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    const order: string[] = [];
    const base = tableMigration('20240101000000_first');
    const first: Migration = {
      name: base.name,
      up: async (d) => {
        order.push('first');
        await base.up(d);
      },
      down: base.down,
    };
    const second: Migration = {
      name: '20240202000000_second',
      up: async (d) => {
        order.push('second');
        await d.execute(buildAddColumn(sqlite, 'posts', 'nick', { type: 'string', length: 20 }), []);
      },
      down: async (d) => {
        await d.execute('ALTER TABLE "posts" DROP COLUMN "nick"', []);
      },
    };
    const r1 = await migrate(driver, [second, first]);
    expect(order).toEqual(['first', 'second']);
    expect(r1.applied).toEqual(['20240101000000_first', '20240202000000_second']);
    expect(r1.batch).toBe(1);
    expect(await tables(driver)).toContain('posts');
    const r2 = await migrate(driver, [second, first]);
    expect(r2.applied).toEqual([]);
    await driver.close();
  });

  it('rolls back the last batch only', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await migrate(driver, [tableMigration('20240101000000_first')]);
    const second: Migration = {
      name: '20240202000000_second',
      up: async (d) => {
        await d.execute('CREATE TABLE IF NOT EXISTS "tags" ("id" INTEGER PRIMARY KEY, "label" TEXT)', []);
      },
      down: async (d) => {
        await d.execute('DROP TABLE "tags"', []);
      },
    };
    await migrate(driver, [tableMigration('20240101000000_first'), second]);
    expect(await tables(driver)).toContain('tags');
    const out = await rollback(driver, [tableMigration('20240101000000_first'), second]);
    expect(out.reverted).toEqual(['20240202000000_second']);
    const rest = await tables(driver);
    expect(rest).toContain('posts');
    expect(rest).not.toContain('tags');
    await driver.close();
  });

  it('stops on a failing migration without recording it', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    const bad: Migration = {
      name: '20240303000000_bad',
      up: async () => {
        throw new Error('nope');
      },
      down: async () => {},
    };
    await expect(migrate(driver, [tableMigration('20240101000000_first'), bad])).rejects.toThrow('nope');
    const settled = await migrate(driver, [tableMigration('20240101000000_first')]);
    expect(settled.applied).toEqual([]);
    await driver.close();
  });

  it('throws clearly when rollback lacks a definition', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await migrate(driver, [tableMigration('20240101000000_first')]);
    await expect(rollback(driver, [])).rejects.toThrow(/20240101000000_first/);
    await driver.close();
  });
});

describe('tracking sql per dialect (issue 24)', () => {
  it('quotes identifiers and keys the name safely on every engine', () => {
    expect(trackingSql(mysql).createTable).toBe(
      'CREATE TABLE IF NOT EXISTS `tsorm_migrations` (`name` VARCHAR(255) NOT NULL PRIMARY KEY, ' +
        '`batch` INT NOT NULL, `applied_at` DATETIME NOT NULL)',
    );
    expect(trackingSql(mysql).insertRow).toBe(
      'INSERT INTO `tsorm_migrations` (`name`, `batch`, `applied_at`) VALUES (?, ?, ?)',
    );
    expect(trackingSql(postgres).insertRow).toBe(
      'INSERT INTO "tsorm_migrations" ("name", "batch", "applied_at") VALUES ($1, $2, $3)',
    );
    expect(trackingSql(postgres).deleteRow).toBe('DELETE FROM "tsorm_migrations" WHERE "name" = $1');
    expect(trackingSql(mssql).createTable).toContain('[name] VARCHAR(255) NOT NULL PRIMARY KEY');
    expect(trackingSql(mssql).createTable.startsWith('IF OBJECT_ID')).toBe(true);
    expect(trackingSql(mssql).insertRow).toContain('@p1, @p2, @p3');
    expect(trackingSql(sqlite).selectAll).toBe(
      'SELECT "name", "batch" FROM "tsorm_migrations" ORDER BY "name"',
    );
  });
});

describe('migration cli (issue 24)', () => {
  // File-backed sqlite: runCli closes the driver in a finally, and a
  // :memory: database would reopen empty on the next command.
  let dir = '';
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  function cliDeps(migrations: Migration[]): {
    deps: Parameters<typeof runCli>[1];
    out: string[];
    err: string[];
    driver: Driver;
  } {
    const out: string[] = [];
    const err: string[] = [];
    dir = mkdtempSync(join(tmpdir(), 'tsorm-migrate-'));
    const driver = createSqliteDriver({ filename: join(dir, 'cli.db') });
    return {
      deps: {
        createDriver: () => driver,
        writeFile: () => {},
        log: (m) => void out.push(m),
        errorLog: (m) => void err.push(m),
        listFiles: () => ['20240101000000_first.mjs'],
        importMigration: async () => migrations[0] as Migration,
      },
      out,
      err,
      driver,
    };
  }

  it('migrates and rolls back through injected loading', async () => {
    const seen = cliDeps([tableMigration('20240101000000_first')]);
    expect(await runCli(['migrate'], seen.deps)).toBe(0);
    expect(await tables(seen.driver)).toContain('posts');
    expect(seen.out.join('\n')).toContain('20240101000000_first');
    expect(await runCli(['migrate:rollback'], seen.deps)).toBe(0);
    expect(await tables(seen.driver)).not.toContain('posts');
    await seen.driver.close();
  });

  it('scaffolds a migration file with up and down', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const out: string[] = [];
    const driver = createSqliteDriver({ filename: ':memory:' });
    const code = await runCli(['make:migration', 'add_posts'], {
      createDriver: () => driver,
      writeFile: (path, data) => void writes.push({ path, data }),
      makeDir: () => {},
      log: (m) => void out.push(m),
      errorLog: () => {},
    });
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toMatch(/migrations\/\d{14}_add_posts\.mjs$/);
    expect(writes[0]!.data).toContain('export async function up');
    expect(writes[0]!.data).toContain('export async function down');
    await driver.close();
  });

  it('rejects unknown migration commands with usage', async () => {
    const seen = cliDeps([]);
    expect(await runCli(['migrate:sideways'], seen.deps)).toBe(1);
    expect(seen.out.join('\n')).toContain('Usage:');
    await seen.driver.close();
  });
});

describe('default migration loader (issue 24)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  function loaderDeps(): {
    deps: Parameters<typeof runCli>[1];
    out: string[];
    err: string[];
    driver: Driver;
  } {
    const out: string[] = [];
    const err: string[] = [];
    dir = mkdtempSync(join(tmpdir(), 'tsorm-loader-'));
    const driver = createSqliteDriver({ filename: join(dir, 'loader.db') });
    return {
      deps: {
        createDriver: () => driver,
        writeFile: (path, data) => void writeFileSync(path, data),
        makeDir: () => {},
        log: (m) => void out.push(m),
        errorLog: (m) => void err.push(m),
        migrationsDir: dir,
      },
      out,
      err,
      driver,
    };
  }

  it('migrates and rolls back real files through the default loader', async () => {
    const seen = loaderDeps();
    writeFileSync(
      join(dir, '20240101000000_create_widgets.mjs'),
      'export async function up(driver) {\n' +
        '  await driver.execute(\'CREATE TABLE IF NOT EXISTS "widgets" ("id" INTEGER PRIMARY KEY, "label" TEXT)\', []);\n' +
        '}\n' +
        'export async function down(driver) {\n' +
        '  await driver.execute(\'DROP TABLE "widgets"\', []);\n' +
        '}\n',
    );
    expect(await runCli(['migrate'], seen.deps)).toBe(0);
    expect(await tables(seen.driver)).toContain('widgets');
    expect(seen.out.join('\n')).toContain('20240101000000_create_widgets');
    expect(await runCli(['migrate:rollback'], seen.deps)).toBe(0);
    expect(await tables(seen.driver)).not.toContain('widgets');
    await seen.driver.close();
  });

  it('fails friendly when a file lacks up and down', async () => {
    const seen = loaderDeps();
    writeFileSync(join(dir, '20240101000000_empty.mjs'), 'export const nothing = 1;\n');
    expect(await runCli(['migrate'], seen.deps)).toBe(1);
    expect(seen.err.join('\n')).toContain('up and down');
    await seen.driver.close();
  });
});
