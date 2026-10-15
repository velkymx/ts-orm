import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { loadPgPeer } from '../src/drivers/postgres.js';
import { loadMssqlPeer } from '../src/drivers/mssql.js';

function stubRequire(): never {
  throw Object.assign(new Error("Cannot find module 'peer'"), { code: 'MODULE_NOT_FOUND' });
}

describe('optional peer absence (issue 102)', () => {
  it('imports the barrel and creates every factory with peers blocked', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-strip-types',
        '--import',
        './tests/strip-register.mjs',
        '--import',
        './tests/fixtures/peer-block-register.mjs',
        './tests/fixtures/peer-absence-probe.ts',
      ],
      { encoding: 'utf8' },
    );
    expect(out).toContain('peer-absence-ok');
  });

  it('fails late with an actionable message when the peer is missing', () => {
    expect(() => loadPgPeer(stubRequire)).toThrow(/npm install pg/);
    expect(() => loadMssqlPeer(stubRequire)).toThrow(/npm install mssql/);
  });
});
