import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('./strip-probe.ts', import.meta.url));
const register = fileURLToPath(new URL('./strip-register.mjs', import.meta.url));

/**
 * Issue 31 acceptance: TS sources run under Node type stripping with no
 * build step. The probe imports real sources and runs a sqlite round
 * trip; the register hook only maps nodenext `.js` specifiers to their
 * `.ts` files, it transpiles nothing, so any non-erasable construct in
 * the import graph fails the run.
 */
describe('erasable syntax (issue 31)', () => {
  it('runs sources under type stripping without transpilation', () => {
    const run = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--import', register, probe],
      { encoding: 'utf8', timeout: 60000 },
    );
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    const line = run.stdout.trim().split('\n').pop() as string;
    expect(JSON.parse(line)).toEqual({ id: 1, name: 'ada' });
  });
});
