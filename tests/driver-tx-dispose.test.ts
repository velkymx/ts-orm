import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TxConnection } from '../src/driver.js';

const { fakeMysqlConn, fakePgClient, fakePgPool, fakeMssqlTx, fakeMssqlPool } = vi.hoisted(() => {
  const fakePgClient = {
    query: vi.fn(async () => ({})),
    release: vi.fn(),
  };
  const fakeMssqlTx = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };
  const fakeMssqlPool = {
    connect: vi.fn(),
  };
  return {
    fakeMysqlConn: {
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(),
    },
    fakePgClient,
    fakePgPool: {
      connect: vi.fn(async () => fakePgClient),
      end: vi.fn(),
    },
    fakeMssqlTx,
    fakeMssqlPool,
  };
});

vi.mock('../src/connection.js', () => ({
  getPool: () => ({
    getConnection: async () => fakeMysqlConn,
  }),
  closePool: async () => {},
}));

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === 'pg') return { Pool: class { constructor() { return fakePgPool; } } };
      if (id === 'mssql') {
        return {
          ConnectionPool: class { constructor() { return fakeMssqlPool; } },
          Transaction: class { constructor() { return fakeMssqlTx; } },
        };
      }
      throw new Error(`unexpected peer require: ${id}`);
    },
  };
});

import { createMysqlDriver } from '../src/drivers/mysql.js';
import { createPostgresDriver } from '../src/drivers/postgres.js';
import { createMssqlDriver } from '../src/drivers/mssql.js';

process.env['DB_HOST'] ??= 'localhost';
process.env['DB_USER'] ??= 'test';
process.env['DB_PASSWORD'] ??= 'test';
process.env['DB_DATABASE'] ??= 'test';

async function begin(driver: ReturnType<typeof createMysqlDriver>): Promise<TxConnection> {
  const beginTx = driver.beginTransaction;
  if (!beginTx) throw new Error('expected beginTransaction');
  return beginTx();
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeMssqlPool.connect.mockResolvedValue(fakeMssqlPool);
});

describe('raw tx dispose rolls back unsettled work (issue 123)', () => {
  it('mysql rolls back then releases, in order', async () => {
    const tx = await begin(createMysqlDriver());
    await tx[Symbol.asyncDispose]();
    expect(fakeMysqlConn.rollback).toHaveBeenCalledTimes(1);
    expect(fakeMysqlConn.release).toHaveBeenCalledTimes(1);
    expect(fakeMysqlConn.rollback.mock.invocationCallOrder[0]).toBeLessThan(
      fakeMysqlConn.release.mock.invocationCallOrder[0] as number,
    );
  });

  it('mysql skips rollback after commit', async () => {
    const tx = await begin(createMysqlDriver());
    await tx.commit();
    await tx[Symbol.asyncDispose]();
    expect(fakeMysqlConn.rollback).not.toHaveBeenCalled();
    expect(fakeMysqlConn.release).toHaveBeenCalledTimes(1);
  });

  it('postgres rolls back then releases, in order', async () => {
    const tx = await begin(createPostgresDriver());
    await tx[Symbol.asyncDispose]();
    expect(fakePgClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(fakePgClient.release).toHaveBeenCalledTimes(1);
  });

  it('postgres skips rollback after rollback', async () => {
    const tx = await begin(createPostgresDriver());
    await tx.rollback();
    await tx[Symbol.asyncDispose]();
    expect(fakePgClient.query).toHaveBeenCalledTimes(2);
    expect(fakePgClient.release).toHaveBeenCalledTimes(1);
  });

  it('mssql rolls back an unsettled transaction on dispose', async () => {
    const begin = createMssqlDriver().beginTransaction;
    if (!begin) throw new Error('expected mssql beginTransaction');
    const tx = await begin();
    await tx[Symbol.asyncDispose]();
    expect(fakeMssqlTx.rollback).toHaveBeenCalledTimes(1);
  });

  it('mssql skips rollback after commit', async () => {
    const begin = createMssqlDriver().beginTransaction;
    if (!begin) throw new Error('expected mssql beginTransaction');
    const tx = await begin();
    await tx.commit();
    await tx[Symbol.asyncDispose]();
    expect(fakeMssqlTx.rollback).not.toHaveBeenCalled();
  });
});
