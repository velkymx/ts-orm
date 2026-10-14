import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('./strip-probe.ts', import.meta.url));
const register = fileURLToPath(new URL('./strip-register.mjs', import.meta.url));

function stripped(entry: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--import', register, entry], {
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(run.error).toBeUndefined();
  return { status: run.status, stdout: run.stdout as string, stderr: run.stderr as string };
}

/**
 * Issue 31 acceptance: TS sources run under Node type stripping with no
 * build step. The probe imports real sources and runs a sqlite round
 * trip; the register hook only maps nodenext `.js` specifiers to their
 * `.ts` files, it transpiles nothing, so any non-erasable construct in
 * the import graph fails the run.
 */
describe('erasable syntax (issue 31)', () => {
  it('runs sources under type stripping without transpilation', () => {
    const run = stripped(probe);
    expect(run.status).toBe(0);
    const line = run.stdout.trim().split('\n').pop();
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toEqual({ id: 1, name: 'ada' });
  });

  it('rejects non-erasable syntax through the same spawn path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsorm-strip-'));
    try {
      const poison = join(dir, 'poison.ts');
      writeFileSync(poison, 'enum Poison { A = 1 }\nconsole.log(Poison.A);\n');
      const run = stripped(poison);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/typescript|non-erasable|enum/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
