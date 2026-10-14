import { describe, it, expect } from 'vitest';
import { mapMysqlError } from '../src/drivers/mysql.js';
import { mapPostgresError } from '../src/drivers/postgres.js';
import { mapSqliteError } from '../src/drivers/sqlite.js';
import { mapMssqlError } from '../src/drivers/mssql.js';

describe('mapMysqlError', () => {
  it('normalizes mysql error codes', () => {
    expect(mapMysqlError({ code: 'ER_DUP_ENTRY' }).code).toBe('duplicate');
    expect(mapMysqlError({ code: 'ER_NO_REFERENCED_ROW_2' }).code).toBe('foreign_key');
    expect(mapMysqlError({ code: 'ER_BAD_NULL_ERROR' }).code).toBe('not_null');
    expect(mapMysqlError({ code: 'ER_WHATEVER' }).code).toBe('unknown');
  });
});

describe('mapPostgresError', () => {
  it('normalizes postgres SQLSTATE codes', () => {
    expect(mapPostgresError({ code: '23505' }).code).toBe('duplicate');
    expect(mapPostgresError({ code: '23503' }).code).toBe('foreign_key');
    expect(mapPostgresError({ code: '23502' }).code).toBe('not_null');
    expect(mapPostgresError({ code: '00000' }).code).toBe('unknown');
  });
});

describe('mapSqliteError', () => {
  it('normalizes sqlite constraint messages', () => {
    expect(mapSqliteError(new Error('UNIQUE constraint failed: users.email')).code).toBe('duplicate');
    expect(mapSqliteError(new Error('FOREIGN KEY constraint failed')).code).toBe('foreign_key');
    expect(mapSqliteError(new Error('NOT NULL constraint failed: users.name')).code).toBe('not_null');
    expect(mapSqliteError(new Error('syntax error')).code).toBe('unknown');
  });
});

describe('mapMssqlError', () => {
  it('normalizes SQL Server error numbers', () => {
    expect(mapMssqlError({ number: 2627 }).code).toBe('duplicate');
    expect(mapMssqlError({ number: 2601 }).code).toBe('duplicate');
    expect(mapMssqlError({ number: 547 }).code).toBe('foreign_key');
    expect(mapMssqlError({ number: 515 }).code).toBe('not_null');
    expect(mapMssqlError({ number: 9999 }).code).toBe('unknown');
  });
});
