import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDefaultDriver } from '../src/default-driver.js';

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved['DB_DIALECT'] = process.env['DB_DIALECT'];
  delete process.env['DB_DIALECT'];
});

afterEach(() => {
  if (saved['DB_DIALECT'] === undefined) delete process.env['DB_DIALECT'];
  else process.env['DB_DIALECT'] = saved['DB_DIALECT'];
});

describe('createDefaultDriver (issue 98)', () => {
  it('resolves each supported engine from the environment', () => {
    for (const [dialect, name] of [
      ['mysql', 'mysql'],
      ['postgres', 'postgres'],
      ['sqlite', 'sqlite'],
      ['mssql', 'mssql'],
    ] as const) {
      process.env['DB_DIALECT'] = dialect;
      expect(createDefaultDriver().dialect.name).toBe(name);
    }
  });

  it('defaults to mysql when unset', () => {
    expect(createDefaultDriver().dialect.name).toBe('mysql');
  });

  it('throws listing supported engines on unknown values', () => {
    process.env['DB_DIALECT'] = 'oracle';
    expect(() => createDefaultDriver()).toThrow(/mysql.*postgres.*sqlite.*mssql/s);
  });

  it('runs DDL and queries with no setup beyond the environment', async () => {
    process.env['DB_DIALECT'] = 'sqlite';
    const driver = createDefaultDriver();
    expect(driver.dialect.name).toBe('sqlite');
    await driver.execute('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "n" INTEGER)', []);
    await driver.execute('INSERT INTO "t" ("n") VALUES (7)', []);
    const rows = await driver.query<Record<string, unknown>>('SELECT * FROM "t"', []);
    expect(rows.map((r) => r['n'])).toEqual([7]);
    await driver.close();
  });
});
