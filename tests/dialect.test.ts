import { describe, it, expect } from 'vitest';
import { mysql, postgres, sqlite, mssql } from '../src/dialect.js';

describe('quoteIdent', () => {
  it('uses the engine-specific quote character', () => {
    expect(mysql.quoteIdent('users')).toBe('`users`');
    expect(postgres.quoteIdent('users')).toBe('"users"');
    expect(sqlite.quoteIdent('users')).toBe('"users"');
    expect(mssql.quoteIdent('users')).toBe('[users]');
  });
});

describe('placeholder', () => {
  it('renders the engine-specific parameter marker (1-based)', () => {
    expect(mysql.placeholder(1)).toBe('?');
    expect(sqlite.placeholder(3)).toBe('?');
    expect(postgres.placeholder(1)).toBe('$1');
    expect(postgres.placeholder(2)).toBe('$2');
    expect(mssql.placeholder(1)).toBe('@p1');
  });
});

describe('limitOffset', () => {
  it('returns empty when neither is set', () => {
    expect(mysql.limitOffset()).toBe('');
    expect(mssql.limitOffset()).toBe('');
  });

  it('renders LIMIT/OFFSET for the standard engines', () => {
    expect(mysql.limitOffset(10)).toBe('LIMIT 10');
    expect(postgres.limitOffset(10, 20)).toBe('LIMIT 10 OFFSET 20');
    expect(sqlite.limitOffset(5, 15)).toBe('LIMIT 5 OFFSET 15');
  });

  it('renders OFFSET/FETCH for MSSQL', () => {
    expect(mssql.limitOffset(10, 20)).toBe('OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY');
    expect(mssql.limitOffset(10)).toBe('OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY');
  });
});

describe('insertIdStrategy', () => {
  it('names how each engine returns a new row id', () => {
    expect(mysql.insertIdStrategy).toBe('driver');
    expect(sqlite.insertIdStrategy).toBe('driver');
    expect(postgres.insertIdStrategy).toBe('returning');
    expect(mssql.insertIdStrategy).toBe('output');
  });
});

describe('name', () => {
  it('identifies the dialect', () => {
    expect(mysql.name).toBe('mysql');
    expect(postgres.name).toBe('postgres');
    expect(sqlite.name).toBe('sqlite');
    expect(mssql.name).toBe('mssql');
  });
});
