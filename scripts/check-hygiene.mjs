/**
 * Repo hygiene: legacy JS must stay out of src, and every dist output must
 * trace to a src counterpart so stale builds never ship. Run after build
 * in CI. Exits non-zero listing violations.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const root = process.cwd();
for (const file of walk(join(root, 'src'))) {
  failures.push(`legacy JS in src: ${file}`);
}

for (const file of walk(join(root, 'dist'))) {
  const rel = file.slice(join(root, 'dist').length + 1).replace(/\.js$/, '');
  const base = join(root, 'src', rel);
  if (!existsSync(`${base}.ts`) && !(rel === 'bin/cli' && existsSync(join(root, 'src/cli.ts')))) {
    failures.push(`stale dist output without src counterpart: ${file}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('hygiene ok');
