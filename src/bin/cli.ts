#!/usr/bin/env node
/**
 * Published binary. A thin wrapper that wires the command logic in `cli.ts` to
 * live dependencies: the shared MySQL driver, the filesystem, and the console.
 * All behavior and error handling live in `runCli`, so this file stays trivial.
 */

import fs from 'node:fs';
import { runCli } from '../cli.js';
import { createMysqlDriver } from '../drivers/mysql.js';

const code = await runCli(process.argv.slice(2), {
  createDriver: createMysqlDriver,
  writeFile: (path, data) => fs.writeFileSync(path, data),
  log: (message) => console.log(message),
  errorLog: (message) => console.error(message),
});

process.exit(code);
