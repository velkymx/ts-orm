#!/usr/bin/env node
/**
 * Published binary. A thin wrapper that wires the command logic in `cli.ts` to
 * live dependencies: the shared MySQL driver, the filesystem, and the console.
 * All behavior and error handling live in `runCli`, so this file stays trivial.
 */

import fs from 'node:fs';
import { runCli } from '../cli.js';
import { createMysqlDriver } from '../drivers/mysql.js';

// Set exitCode rather than calling process.exit: the pool is already closed,
// so the process drains naturally without truncating piped stdout.
process.exitCode = await runCli(process.argv.slice(2), {
  createDriver: createMysqlDriver,
  writeFile: (path, data) => fs.writeFileSync(path, data),
  log: (message) => console.log(message),
  errorLog: (message) => console.error(message),
});
