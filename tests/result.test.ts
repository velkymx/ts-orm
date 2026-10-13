import { describe, it, expect, expectTypeOf } from 'vitest';
import { ok, fail, type Result } from '../src/result.js';

describe('Result envelope', () => {
  it('ok() builds a success result carrying typed data', () => {
    const r = ok({ id: 7 });
    expect(r.success).toBe(true);
    expect(r.message).toBe('OK');
    expect(r.data).toEqual({ id: 7 });
  });

  it('ok() accepts a custom message', () => {
    const r = ok(42, 'Record created');
    expect(r.success).toBe(true);
    expect(r.message).toBe('Record created');
    expect(r.data).toBe(42);
  });

  it('fail() builds a failure result with an errors array', () => {
    const r = fail('Validation failed', ['email is required']);
    expect(r.success).toBe(false);
    expect(r.message).toBe('Validation failed');
    expect(r.errors).toEqual(['email is required']);
  });

  it('fail() defaults errors to an empty array', () => {
    const r = fail('Database operation failed');
    expect(r.success).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('discriminates on success at the type level', () => {
    const r = ok('hi') as Result<string>;
    if (r.success) {
      expectTypeOf(r.data).toEqualTypeOf<string>();
    } else {
      expectTypeOf(r.errors).toEqualTypeOf<readonly string[]>();
    }
  });
});
