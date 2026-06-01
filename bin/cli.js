#!/usr/bin/env node

// Built output: src is TypeScript, node runs the compiled dist. Run `npm run
// build` before using the CLI from a source checkout.
import { generateStructFromTable } from '../dist/introspect.js';
import fs from 'fs';

const [,, command, tableName] = process.argv;

if (command === 'struct' && tableName) {
  const struct = await generateStructFromTable(tableName);
  const filePath = `./${tableName}.json`;

  fs.writeFileSync(filePath, JSON.stringify(struct, null, 2));
  console.log(`Struct written to ${filePath}`);
} else {
  console.log('Usage: ts-orm struct <tableName>');
  process.exit(1);
}