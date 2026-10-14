import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeRequest, fakePool } = vi.hoisted(() => {
  const fakeRequest = {
    input: vi.fn(),
    query: vi.fn(),
  };
  const fakePool = {
    request: vi.fn(() => fakeRequest),
    connect: vi.fn(),
    close: vi.fn(),
  };
  return { fakeRequest, fakePool };
});

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === 'mssql') {
        return {
          ConnectionPool: class {
            constructor() { return fakePool; }
          },
          Transaction: class {
            begin = vi.fn(async () => {});
          },
          Request: class {
            constructor() { return fakeRequest; }
          },
        };
      }
      throw new Error(`unexpected peer require: ${id}`);
    },
  };
});

import { createMssqlDriver } from '../src/drivers/mssql.js';

process.env['DB_HOST'] ??= 'localhost';
process.env['DB_USER'] ??= 'test';
process.env['DB_PASSWORD'] ??= 'test';
process.env['DB_DATABASE'] ??= 'test';

beforeEach(() => {
  vi.clearAllMocks();
  fakePool.connect.mockResolvedValue(fakePool);
});

describe('mssql undefined recordset (issue 130)', () => {
  it('query returns an empty array when the batch yields no recordset', async () => {
    fakeRequest.query.mockResolvedValueOnce({ recordset: undefined, rowsAffected: [1] });
    const rows = await createMssqlDriver().query('UPDATE "t" SET "a" = @p1', [1]);
    expect(rows).toEqual([]);
  });
});
