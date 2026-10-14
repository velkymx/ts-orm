#!/usr/bin/env node

import { createMysqlDriver, generateStructFromTable, closePool } from '../dist/index.js';
import fs from 'fs';

const [,, command, tableName] = process.argv;

if (command === 'struct' && tableName) {
  const driver = createMysqlDriver();
  const struct = await generateStructFromTable(driver, tableName);
  const filePath = `./${tableName}.json`;

  fs.writeFileSync(filePath, JSON.stringify(struct, null, 2));
  console.log(`Struct written to ${filePath}`);
  await closePool();
} else {
  console.log('Usage: ts-orm struct <tableName>');
  process.exit(1);
}