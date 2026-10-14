/**
 * Command line entry logic, kept free of process and filesystem globals so the
 * orchestration is unit testable the way the mapping layer is. The real binary
 * (`src/bin/cli.ts`) supplies live dependencies; tests supply recording stubs.
 *
 * Commands: `struct <table>` introspects a live table through the shared
 * driver and writes the mapped fields to `./<table>.json`; `migrate` applies
 * pending migrations from the migrations directory; `migrate:rollback`
 * reverses the latest batch; `make:migration <name>` scaffolds a migration
 * file. Failures surface as a friendly line and a non-zero exit, and the
 * pool always closes.
 */

import { mkdirSync, readdirSync } from 'node:fs';
import type { Driver } from './driver.js';
import { OrmError, sanitizeError } from './errors.js';
import { generateStructFromTable } from './introspect.js';
import { migrate, rollback, type Migration } from './migrate.js';

const USAGE = [
  'Usage:',
  '  ts-orm struct <tableName>',
  '  ts-orm migrate',
  '  ts-orm migrate:rollback',
  '  ts-orm make:migration <name>',
].join('\n');

/** One migration file as dynamically imported. */
interface MigrationModule {
  readonly up?: unknown;
  readonly down?: unknown;
  readonly default?: unknown;
  readonly migration?: unknown;
}

/** Injected side effects, so the command logic touches no globals directly. */
export interface CliDeps {
  /** Build the driver whose shared pool backs introspection. */
  createDriver: () => Driver;
  /** Persist the generated struct file. */
  writeFile: (path: string, data: string) => void;
  /** Create a directory and its parents. Defaults to recursive mkdir. */
  makeDir?: (dir: string) => void;
  /** Write a normal line (command output). */
  log: (message: string) => void;
  /** Write an error line (diagnostics). */
  errorLog: (message: string) => void;
  /** List migration files in a directory. Defaults to a sorted readdir. */
  listFiles?: (dir: string) => string[];
  /** Import one migration file. Defaults to dynamic import with shape check. */
  importMigration?: (path: string) => Promise<Migration>;
  /** Migrations directory for migrate commands. Defaults to ./migrations. */
  migrationsDir?: string;
  /** Clock for scaffold timestamps. Defaults to the wall clock. */
  now?: () => Date;
}

/** Safe, human-facing reason for a failure. */
function reason(error: unknown, operation: string): string {
  if (error instanceof OrmError) {
    return sanitizeError(error, operation);
  }
  return error instanceof Error ? error.message : String(error);
}

/** Migration files: .js or .mjs, sorted oldest first. */
function defaultListFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.js') || file.endsWith('.mjs'))
    .sort();
}

/** Filename stem used as the migration name when the module omits it. */
function stem(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.m?js$/, '');
}

/** Dynamic import with an up/down shape check. */
async function defaultImportMigration(path: string): Promise<Migration> {
  const module = (await import(path)) as MigrationModule;
  const candidate = (module.default ?? module.migration ?? module) as {
    up?: unknown;
    down?: unknown;
    name?: unknown;
  };
  if (typeof candidate.up !== 'function' || typeof candidate.down !== 'function') {
    throw new Error(`"${path}" must export up and down functions`);
  }
  type MigrationFn = (driver: Driver) => Promise<void>;
  const name = typeof candidate.name === 'string' ? candidate.name : stem(path);
  return { name, up: candidate.up as MigrationFn, down: candidate.down as MigrationFn };
}

/** Load every migration in the directory through the injected loader. */
async function loadMigrations(deps: CliDeps): Promise<Migration[]> {
  const dir = deps.migrationsDir ?? './migrations';
  const list = (deps.listFiles ?? defaultListFiles)(dir);
  const load = deps.importMigration ?? defaultImportMigration;
  const out: Migration[] = [];
  for (const file of list) {
    out.push(await load(`${dir.replace(/\/$/, '')}/${file}`));
  }
  return out;
}

/** Compact UTC stamp for scaffold filenames. */
function stamp(now: Date): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Scaffold content: plain JS with up/down stubs, runnable with no build. */
function scaffold(): string {
  return `// Describe the change above up, then implement both directions.\n` +
    `export async function up(driver) {\n  // await driver.execute(...);\n}\n\n` +
    `export async function down(driver) {\n  // await driver.execute(...);\n}\n`;
}

async function structCommand(tableName: string, deps: CliDeps): Promise<number> {
  const driver = deps.createDriver();
  try {
    const fields = await generateStructFromTable(driver, tableName);
    const filePath = `./${tableName}.json`;
    deps.writeFile(filePath, JSON.stringify(fields, null, 2));
    deps.log(`Struct written to ${filePath}`);
    return 0;
  } catch (error) {
    deps.errorLog(`Failed to generate struct for "${tableName}": ${reason(error, `introspect ${tableName}`)}`);
    return 1;
  } finally {
    await driver.close();
  }
}

async function migrateCommand(deps: CliDeps): Promise<number> {
  const driver = deps.createDriver();
  try {
    const result = await migrate(driver, await loadMigrations(deps));
    deps.log(
      result.applied.length === 0
        ? 'Nothing to migrate.'
        : `Migrated batch ${result.batch}: ${result.applied.join(', ')}`,
    );
    return 0;
  } catch (error) {
    deps.errorLog(`Migration failed: ${reason(error, 'migrate')}`);
    return 1;
  } finally {
    await driver.close();
  }
}

async function rollbackCommand(deps: CliDeps): Promise<number> {
  const driver = deps.createDriver();
  try {
    const result = await rollback(driver, await loadMigrations(deps));
    deps.log(result.reverted.length === 0 ? 'Nothing to roll back.' : `Rolled back: ${result.reverted.join(', ')}`);
    return 0;
  } catch (error) {
    deps.errorLog(`Rollback failed: ${reason(error, 'rollback')}`);
    return 1;
  } finally {
    await driver.close();
  }
}

/**
 * Run the CLI for already-sliced arguments (no node/script entries) and return
 * the process exit code. Never throws: every failure maps to a logged line and
 * a non-zero code.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [command, arg, ...rest] = argv;

  switch (command) {
    case 'struct': {
      if (!arg || rest.length > 0) {
        deps.log(USAGE);
        return 1;
      }
      return structCommand(arg, deps);
    }
    case 'migrate': {
      if (arg) {
        deps.log(USAGE);
        return 1;
      }
      return migrateCommand(deps);
    }
    case 'migrate:rollback': {
      if (arg) {
        deps.log(USAGE);
        return 1;
      }
      return rollbackCommand(deps);
    }
    case 'make:migration': {
      if (!arg || rest.length > 0 || !/^[A-Za-z0-9_]+$/.test(arg)) {
        deps.log(USAGE);
        return 1;
      }
      const dir = deps.migrationsDir ?? './migrations';
      const filePath = `${dir.replace(/\/$/, '')}/${stamp((deps.now ?? (() => new Date()))())}_${arg.toLowerCase()}.mjs`;
      try {
        (deps.makeDir ?? ((target: string) => void mkdirSync(target, { recursive: true })))(dir);
        deps.writeFile(filePath, scaffold());
      } catch (error) {
        deps.errorLog(`Failed to scaffold migration: ${reason(error, 'make:migration')}`);
        return 1;
      }
      deps.log(`Migration written to ${filePath}`);
      return 0;
    }
    default: {
      deps.log(USAGE);
      return 1;
    }
  }
}
