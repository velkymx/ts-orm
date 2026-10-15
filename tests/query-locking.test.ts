import { describe, it, expect } from 'vitest';
import { query } from '../src/query.js';
import { defineStruct } from '../src/struct.js';
import { mysql, postgres, mssql, sqlite } from '../src/dialect.js';
import type { Driver } from '../src/driver.js';
import type { Dialect } from '../src/dialect.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

function fakeDriver(dialect: Dialect): Driver {
  return {
    dialect,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
}

describe('forUpdate locking (issue 107)', () => {
  it('emits FOR UPDATE on postgres and mysql by default', () => {
    expect(query(fakeDriver(postgres), User).where('id', 1).forUpdate().toSQL().sql).toBe(
      'SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE',
    );
    expect(query(fakeDriver(mysql), User).where('id', 1).forUpdate().toSQL().sql).toBe(
      'SELECT * FROM `users` WHERE `id` = ? FOR UPDATE',
    );
  });

  it('emits the share spelling per dialect', () => {
    expect(query(fakeDriver(postgres), User).forUpdate('share').toSQL().sql).toBe(
      'SELECT * FROM "users" FOR SHARE',
    );
    expect(query(fakeDriver(mysql), User).forUpdate('share').toSQL().sql).toBe(
      'SELECT * FROM `users` LOCK IN SHARE MODE',
    );
  });

  it('throws at compile time on sqlite and mssql', () => {
    expect(() => query(fakeDriver(sqlite), User).forUpdate().toSQL()).toThrow(/sqlite/i);
    expect(() => query(fakeDriver(mssql), User).forUpdate().toSQL()).toThrow(/mssql/i);
  });

  it('survives clone chains like paginate', () => {
    const sql = query(fakeDriver(postgres), User).forUpdate().limit(10).toSQL().sql;
    expect(sql).toBe('SELECT * FROM "users" LIMIT 10 FOR UPDATE');
  });
});
