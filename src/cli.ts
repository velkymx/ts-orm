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

import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Driver } from './driver.js';
import { OrmError, sanitizeError } from './errors.js';
import { generateStructFromTable } from './introspect.js';
import { migrate, rollback, type Migration } from './migrate.js';

const USAGE = [
  'Usage:',
  '  ts-orm struct <tableName>',
  '  ts-orm model <tableName> [--force]',
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
  /** Test whether a scaffold target already exists. Defaults to existsSync. */
  existsFile?: (path: string) => boolean;
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
  // Resolve against the caller's working directory as a file URL: a bare
  // relative specifier would resolve against this module instead.
  const url = pathToFileURL(resolve(process.cwd(), path)).href;
  const module = (await import(url)) as MigrationModule;
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

/**
 * PascalCase class name for a table, with no inflection: `users` becomes
 * `Users`, never a guessed singular. Throws when the table cannot start
 * a valid class name.
 */
function classNameFor(tableName: string): string {
  const name = tableName.charAt(0).toUpperCase() + tableName.slice(1);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Cannot derive a class name from table "${tableName}"`);
  }
  return name;
}

/** Render one introspected field as struct source. Falsy defaults carry no meaning, so they stay out. */
function renderField(field: { name: string; type: string; required: boolean; length: number | null; default: string | null; enum?: readonly string[] }): string {
  const parts = [`type: '${field.type}'`];
  if (field.required) parts.push('required: true');
  if (field.length !== null && field.type !== 'number' && field.type !== 'boolean') {
    parts.push(`length: ${field.length}`);
  }
  if (field.default) parts.push(`default: '${field.default}'`);
  if (field.enum) parts.push(`enum: [${field.enum.map((v) => `'${v}'`).join(', ')}]`);
  return `  ${field.name}: { ${parts.join(', ')} },`;
}

/** Regenerable struct module: safe to overwrite on every rebuild. */
function structFile(tableName: string, structName: string, fields: Array<{ name: string; type: string; required: boolean; length: number | null; default: string | null; enum?: readonly string[] }>): string {
  const body = fields.map(renderField).join('\n');
  return (
    `// Generated by ts-orm from table "${tableName}". Do not edit: rerun \`ts-orm model ${tableName}\` to refresh.\n` +
    `import { defineStruct } from '@velkymx/ts-orm';\n` +
    `\n` +
    `export const ${structName} = defineStruct('${tableName}', {\n` +
    `${body}\n` +
    `});\n`
  );
}

/** Hand-editable model stub: created once, never overwritten without --force. */
function modelFile(className: string, structName: string, structPath: string): string {
  return (
    `import { defineModel } from '@velkymx/ts-orm';\n` +
    `import { ${structName} } from './${structPath}';\n` +
    `\n` +
    `export class ${className} extends defineModel(${structName}) {}\n`
  );
}

async function modelCommand(tableName: string, force: boolean, deps: CliDeps): Promise<number> {
  const className = classNameFor(tableName);
  const structName = `${className}Struct`;
  const structPath = `./${tableName}.struct.ts`;
  const modelPath = `./${className}.ts`;
  const exists = deps.existsFile ?? existsSync;
  const driver = deps.createDriver();
  try {
    const fields = await generateStructFromTable(driver, tableName);
    deps.writeFile(structPath, structFile(tableName, structName, fields));
    deps.log(`Struct written to ${structPath}`);
    if (!force && exists(modelPath)) {
      deps.log(`Model left untouched at ${modelPath}: use --force to overwrite`);
      return 0;
    }
    deps.writeFile(modelPath, modelFile(className, structName, `${tableName}.struct.js`));
    deps.log(`Model written to ${modelPath}`);
    return 0;
  } catch (error) {
    deps.errorLog(`Failed to generate model for "${tableName}": ${reason(error, `model ${tableName}`)}`);
    return 1;
  } finally {
    await driver.close();
  }
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
    case 'model': {
      if (!arg || (rest.length === 1 && rest[0] !== '--force') || rest.length > 1) {
        deps.log(USAGE);
        return 1;
      }
      try {
        return await modelCommand(arg, rest[0] === '--force', deps);
      } catch {
        deps.log(USAGE);
        return 1;
      }
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
