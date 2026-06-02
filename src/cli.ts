#!/usr/bin/env node

import { generateStructFromTable } from './introspect.js';
import { pool } from './db.js';
import fs from 'fs';

const [, , command, tableName] = process.argv;

if (command === 'struct' && tableName) {
  const struct = await generateStructFromTable(tableName);
  const filePath = `./${tableName}.json`;

  fs.writeFileSync(filePath, JSON.stringify(struct, null, 2));
  console.log(`Struct written to ${filePath}`);

  // Close the shared pool so the process can exit. Its open connections would
  // otherwise keep the event loop alive and the CLI would hang after writing.
  await pool.end();
} else {
  console.log('Usage: vibeorm struct <tableName>');
  process.exit(1);
}
