import { describe, it, expect } from 'vitest';
import {
  isIdentifier,
  isQualifiedIdentifier,
  safeIdentifier,
  safeQualified,
  type SafeIdentifier,
} from '../src/identifiers.js';
import { mysql, postgres } from '../src/dialect.js';

describe('identifier predicates', () => {
  it('accepts alphanumeric and underscore', () => {
    expect(isIdentifier('users')).toBe(true);
    expect(isIdentifier('user_id')).toBe(true);
    expect(isIdentifier('Col123')).toBe(true);
  });

  it('rejects anything outside the allowlist', () => {
    expect(isIdentifier('users; DROP TABLE users--')).toBe(false);
    expect(isIdentifier('a.b')).toBe(false);
    expect(isIdentifier('`x`')).toBe(false);
    expect(isIdentifier('')).toBe(false);
    expect(isIdentifier(42 as unknown as string)).toBe(false);
  });

  it('validates qualified table.column form', () => {
    expect(isQualifiedIdentifier('users.id')).toBe(true);
    expect(isQualifiedIdentifier('users')).toBe(false);
    expect(isQualifiedIdentifier('a.b.c')).toBe(false);
  });
});

describe('safeIdentifier', () => {
  it('quotes a valid identifier for the dialect', () => {
    expect(safeIdentifier('users', mysql)).toBe('`users`');
    expect(safeIdentifier('users', postgres)).toBe('"users"');
  });

  it('throws on an injection attempt', () => {
    expect(() => safeIdentifier('users; DROP TABLE users--', mysql, 'table name')).toThrow(
      /table name/,
    );
  });

  it('throws on empty or non-string input', () => {
    expect(() => safeIdentifier('', mysql)).toThrow();
    expect(() => safeIdentifier(undefined as unknown as string, mysql)).toThrow();
  });
});

describe('safeQualified', () => {
  it('quotes each half of a qualified identifier for the dialect', () => {
    expect(safeQualified('users.id', mysql)).toBe('`users`.`id`');
    expect(safeQualified('users.id', postgres)).toBe('"users"."id"');
  });

  it('throws on a malformed qualified identifier', () => {
    expect(() => safeQualified('users', mysql)).toThrow();
    expect(() => safeQualified('users.id; DROP', mysql)).toThrow();
  });
});

describe('type-level branding', () => {
  it('a SafeIdentifier is usable as a string', () => {
    const id: SafeIdentifier = safeIdentifier('users', mysql);
    const asString: string = id;
    expect(asString).toBe('`users`');
  });

  it('a raw string is not assignable to SafeIdentifier', () => {
    // @ts-expect-error raw strings must go through safeIdentifier()
    const bad: SafeIdentifier = 'users';
    expect(bad).toBe('users');
  });
});
