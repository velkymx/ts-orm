/**
 * Command line entry logic, kept free of process and filesystem globals so the
 * orchestration is unit testable the way the mapping layer is. The real binary
 * (`src/bin/cli.ts`) supplies live dependencies; tests supply recording stubs.
 *
 * Only command: `struct <table>`, which introspects a live table through the
 * shared driver and writes the mapped fields to `./<table>.json`. Failures
 * surface as a friendly line and a non-zero exit, and the pool always closes.
 */

import type { Driver } from './driver.js';
import { OrmError, sanitizeError } from './errors.js';
import { generateStructFromTable } from './introspect.js';

const USAGE = 'Usage: ts-orm struct <tableName>';

/** Injected side effects, so the command logic touches no globals directly. */
export interface CliDeps {
  /** Build the driver whose shared pool backs introspection. */
  createDriver: () => Driver;
  /** Persist the generated struct file. */
  writeFile: (path: string, data: string) => void;
  /** Write a normal line (command output). */
  log: (message: string) => void;
  /** Write an error line (diagnostics). */
  errorLog: (message: string) => void;
}

/** Safe, human-facing reason for a failed introspection. */
function reason(error: unknown, table: string): string {
  if (error instanceof OrmError) {
    return sanitizeError(error, `introspect ${table}`);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the CLI for already-sliced arguments (no node/script entries) and return
 * the process exit code. Never throws: every failure maps to a logged line and
 * a non-zero code.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [command, tableName, ...rest] = argv;

  // Reject unknown commands, a missing table, and surplus arguments so a
  // typo never silently introspects the wrong table or ignores extra input.
  if (command !== 'struct' || !tableName || rest.length > 0) {
    deps.log(USAGE);
    return 1;
  }

  const driver = deps.createDriver();
  try {
    const fields = await generateStructFromTable(driver, tableName);
    const filePath = `./${tableName}.json`;
    deps.writeFile(filePath, JSON.stringify(fields, null, 2));
    deps.log(`Struct written to ${filePath}`);
    return 0;
  } catch (error) {
    deps.errorLog(`Failed to generate struct for "${tableName}": ${reason(error, tableName)}`);
    return 1;
  } finally {
    await driver.close();
  }
}
