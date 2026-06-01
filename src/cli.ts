#!/usr/bin/env node

import { generateStructFromTable } from './introspect.js';
import fs from 'fs';

const [, , command, tableName] = process.argv;

if (command === 'struct' && tableName) {
  const struct = await generateStructFromTable(tableName);
  const filePath = `./${tableName}.json`;

  fs.writeFileSync(filePath, JSON.stringify(struct, null, 2));
  console.log(`Struct written to ${filePath}`);
} else {
  console.log('Usage: vibeorm struct <tableName>');
  process.exit(1);
}
