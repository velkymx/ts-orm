import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrmError } from '../src/errors.js';

const { fakeMysqlConn, fakePgClient, pgPoolConnect } = vi.hoisted(() => ({
  fakeMysqlConn: {
    beginTransaction: vi.fn(),
    release: vi.fn(),
  },
  fakePgClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  pgPoolConnect: vi.fn(),
}));

vi.mock('../src/connection.js', () => ({
  getPool: () => ({
    getConnection: async () => fakeMysqlConn,
  }),
  closePool: async () => {},
}));

vi.mock('pg', () => ({
  Pool: class {
    connect = pgPoolConnect;
  },
}));

import { createMysqlDriver } from '../src/drivers/mysql.js';
import { createPostgresDriver } from '../src/drivers/postgres.js';

process.env['DB_HOST'] ??= 'localhost';
process.env['DB_USER'] ??= 'test';
process.env['DB_PASSWORD'] ??= 'test';
process.env['DB_DATABASE'] ??= 'test';

beforeEach(() => {
  vi.clearAllMocks();
  pgPoolConnect.mockResolvedValue(fakePgClient);
});

describe('failed BEGIN releases the checkout (issue 119)', () => {
  it('mysql releases the connection and maps the error', async () => {
    fakeMysqlConn.beginTransaction.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'PROTOCOL_CONNECTION_LOST' }));
    const begin = createMysqlDriver().beginTransaction;
    if (!begin) throw new Error('expected mysql beginTransaction');
    await expect(begin()).rejects.toBeInstanceOf(OrmError);
    expect(fakeMysqlConn.release).toHaveBeenCalledTimes(1);
  });

  it('postgres releases the client and maps the error', async () => {
    fakePgClient.query.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: '57P01' }));
    const begin = createPostgresDriver().beginTransaction;
    if (!begin) throw new Error('expected postgres beginTransaction');
    await expect(begin()).rejects.toBeInstanceOf(OrmError);
    expect(fakePgClient.release).toHaveBeenCalledTimes(1);
  });
});
