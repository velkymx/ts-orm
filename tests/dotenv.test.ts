import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const register = fileURLToPath(new URL('./strip-register.mjs', import.meta.url));
const barrelProbe = fileURLToPath(new URL('./dotenv-barrel-probe.ts', import.meta.url));
const configProbe = fileURLToPath(new URL('./dotenv-config-probe.ts', import.meta.url));

/**
 * Issue 94: importing the library loads .env automatically, so pool and
 * config need no manual bootstrap. Probes run real sources under type
 * stripping (no build step, so the suite stays self-contained): one
 * through the barrel, one importing config.ts directly to prove the load
 * lives on the shared config path rather than the MySQL pool module.
 */
describe('dotenv autoload (issue 94)', () => {
  function stripped(entry: string, dir: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string } {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--import', register, entry], {
      encoding: 'utf8',
      timeout: 60000,
      cwd: dir,
      env,
    });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    return { status: run.status, stdout: run.stdout as string };
  }

  function cleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('DB_')) delete env[key];
    }
    return env;
  }

  function lastLine(stdout: string): Record<string, unknown> {
    const line = stdout.trim().split('\n').pop();
    expect(line).toBeDefined();
    return JSON.parse(line as string) as Record<string, unknown>;
  }

  it('resolves config from .env on library import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsorm-dotenv-'));
    try {
      writeFileSync(
        join(dir, '.env'),
        'DB_HOST=dotenv-host\nDB_USER=dotenv-user\nDB_PASSWORD=dotenv-secret\nDB_DATABASE=dotenv-db\nDB_PORT=3307\n',
      );
      const run = stripped(barrelProbe, dir, cleanEnv());
      expect(lastLine(run.stdout)).toEqual({
        host: 'dotenv-host',
        user: 'dotenv-user',
        password: 'dotenv-secret',
        database: 'dotenv-db',
        port: 3307,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads through config.ts without the pool module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsorm-dotenv-'));
    try {
      writeFileSync(join(dir, '.env'), 'DB_HOST=dotenv-host\nDB_USER=dotenv-user\nDB_DATABASE=dotenv-db\n');
      const run = stripped(configProbe, dir, cleanEnv());
      expect(lastLine(run.stdout)).toMatchObject({ host: 'dotenv-host', database: 'dotenv-db' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges explicit variables over file settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsorm-dotenv-'));
    try {
      writeFileSync(
        join(dir, '.env'),
        'DB_HOST=dotenv-host\nDB_USER=dotenv-user\nDB_DATABASE=dotenv-db\nDB_PORT=3307\n',
      );
      const env = { ...cleanEnv(), DB_HOST: 'explicit-host', DB_USER: 'explicit-user', DB_DATABASE: 'explicit-db' };
      const run = stripped(barrelProbe, dir, env);
      expect(lastLine(run.stdout)).toEqual({
        host: 'explicit-host',
        user: 'explicit-user',
        password: '',
        database: 'explicit-db',
        port: 3307,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
