import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'check-hygiene.mjs');

function run(cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
    return { code: 0, out };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('hygiene gate (issue 129)', () => {
  it('fails on planted src JS and orphaned dist output', () => {
    const root = join(tmpdir(), `tsorm-hygiene-${Date.now()}`);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'src', 'x.js'), 'export default 1;');
    writeFileSync(join(root, 'dist', 'orphan.js'), 'export default 1;');
    try {
      const result = run(root);
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/legacy JS in src/);
      expect(result.out).toMatch(/stale dist output/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes a clean tree', () => {
    const root = join(tmpdir(), `tsorm-hygiene-clean-${Date.now()}`);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export default 1;');
    writeFileSync(join(root, 'dist', 'a.js'), 'export default 1;');
    try {
      expect(run(root).code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
