import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;

describe('package shape (issue 32)', () => {
  it('points main and types at the built dist entry', () => {
    expect(pkg['main']).toBe('./dist/index.js');
    expect(pkg['types']).toBe('./dist/index.d.ts');
  });

  it('exposes a types-first exports map', () => {
    const exports = pkg['exports'] as Record<string, Record<string, string>>;
    const root = exports['.'] as Record<string, string>;
    expect(root['types']).toBe('./dist/index.d.ts');
    expect(root['import']).toBe('./dist/index.js');
  });

  it('restricts shipped files to the built dist tree', () => {
    expect(pkg['files']).toEqual(['dist']);
  });

  it('builds and tests before publish', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build']).toContain('tsconfig.build.json');
    expect(scripts['prepublishOnly']).toContain('npm run build');
    expect(scripts['prepublishOnly']).toContain('npm test');
  });

  it('points the bin at the built cli and ships its source', () => {
    const bin = pkg['bin'] as Record<string, string>;
    expect(bin['ts-orm']).toBe('./dist/bin/cli.js');
    expect(existsSync(join(root, 'src', 'bin', 'cli.ts'))).toBe(true);
  });
});
