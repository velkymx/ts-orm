import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { validatePayload, type ValidationError } from '../src/validation.js';

const fields = defineStruct('accounts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  email: { type: 'string', required: true, length: 10 },
  role: { type: 'enum', enum: ['a', 'b'] },
  age: { type: 'number' },
  created_at: { type: 'datetime', default: 'current_timestamp' },
}).fields;

describe('validatePayload insert mode (skipAutoIncrement)', () => {
  it('passes a valid insert payload', () => {
    const errors = validatePayload(
      fields,
      { email: 'a@b.co', role: 'a', created_at: 'current_timestamp' },
      { skipAutoIncrement: true },
    );
    expect(errors).toEqual([]);
  });

  it('rejects an auto_increment value supplied by the caller', () => {
    const errors = validatePayload(fields, { id: 5, email: 'a@b.co' }, {
      skipAutoIncrement: true,
    });
    expect(errors).toContainEqual<ValidationError>({
      field: 'id',
      message: 'id should not be provided (auto_increment)',
    });
  });

  it('flags a missing required field', () => {
    const errors = validatePayload(fields, { role: 'a' }, { skipAutoIncrement: true });
    expect(errors).toContainEqual<ValidationError>({
      field: 'email',
      message: 'email is required',
    });
  });
});

describe('validatePayload exact numerics (issue 181)', () => {
  const money = defineStruct('ledger', {
    id: { type: 'number', required: true, default: 'auto_increment' },
    amount: { type: 'decimal', required: true },
    seq: { type: 'bigint' },
  }).fields;

  it('accepts exact-digit strings', () => {
    expect(validatePayload(money, { amount: '12.50', seq: '9007199254740993' }, { skipAutoIncrement: true })).toEqual([]);
  });

  it('rejects lossy numbers and malformed strings', () => {
    expect(validatePayload(money, { amount: 12.5 }, { skipAutoIncrement: true }).map((e) => e.field)).toEqual(['amount']);
    expect(validatePayload(money, { amount: '12.xx' }, { skipAutoIncrement: true }).map((e) => e.field)).toEqual(['amount']);
    expect(validatePayload(money, { amount: '7', seq: '9x' }, { skipAutoIncrement: true }).map((e) => e.field)).toEqual(['seq']);
  });
});

describe('validatePayload partial mode', () => {
  it('skips absent fields so partial updates pass', () => {
    const errors = validatePayload(fields, { email: 'x@y.co' }, { partial: true });
    expect(errors).toEqual([]);
  });

  it('still validates fields that are present', () => {
    const errors = validatePayload(fields, { age: 'abc' }, { partial: true });
    expect(errors).toContainEqual<ValidationError>({
      field: 'age',
      message: 'age must be a number',
    });
  });
});

describe('validatePayload field rules', () => {
  it('rejects an out-of-enum value', () => {
    const errors = validatePayload(fields, { email: 'a@b.co', role: 'z' }, {
      skipAutoIncrement: true,
    });
    expect(errors).toContainEqual<ValidationError>({
      field: 'role',
      message: 'role must be one of a, b',
    });
  });

  it('rejects a string longer than its length', () => {
    const errors = validatePayload(fields, { email: 'way-too-long@example.com' }, {
      skipAutoIncrement: true,
    });
    expect(errors).toContainEqual<ValidationError>({
      field: 'email',
      message: 'email exceeds max length of 10',
    });
  });

  it('accepts current_timestamp for a datetime field but rejects garbage', () => {
    expect(
      validatePayload(fields, { email: 'a@b.co', created_at: 'current_timestamp' }, {
        skipAutoIncrement: true,
      }),
    ).toEqual([]);
    const errors = validatePayload(fields, { email: 'a@b.co', created_at: 'nope' }, {
      skipAutoIncrement: true,
    });
    expect(errors).toContainEqual<ValidationError>({
      field: 'created_at',
      message: 'created_at must be in format YYYY-MM-DD HH:MM:SS',
    });
  });
});
