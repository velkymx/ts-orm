import { describe, it, expect } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { validateRow } from '../src/validation.js';

const fields = defineStruct('accounts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  email: { type: 'string', required: true, length: 10 },
  role: { type: 'enum', enum: ['a', 'b'] },
  age: { type: 'number' },
  active: { type: 'boolean' },
  created_at: { type: 'datetime', default: 'current_timestamp' },
}).fields;

describe('validateRow (issue 104)', () => {
  it('passes a well-formed database row', () => {
    expect(
      validateRow(fields, {
        id: 1,
        email: 'a@b.co',
        role: 'a',
        age: 3,
        active: true,
        created_at: '2024-05-01 10:00:00',
      }),
    ).toEqual([]);
  });

  it('flags null in a required column and wrong runtime types', () => {
    expect(validateRow(fields, { id: null, email: 'a@b.co' })).toEqual(['id is required']);
    expect(validateRow(fields, { id: 1, email: 'a@b.co', age: '3' })).toEqual([
      'age must be a number',
    ]);
    expect(validateRow(fields, { id: 1, email: 'a@b.co', active: 1 })).toEqual([
      'active must be a boolean',
    ]);
    expect(validateRow(fields, { id: 1, email: 'a@b.co', role: 'root' })).toEqual([
      'role must be one of a, b',
    ]);
  });

  it('ignores absent optional columns and extra columns', () => {
    expect(validateRow(fields, { id: 1, email: 'a@b.co', extra: true })).toEqual([]);
  });
});
