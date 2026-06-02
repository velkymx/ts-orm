import { validatePayload } from '../src/validator.js';

// Struct with a required number + required string + optional number.
const struct = [
  { name: 'id', type: 'number', required: true, length: null, default: null },
  { name: 'name', type: 'string', required: true, length: 64, default: '' },
  { name: 'age', type: 'number', required: false, length: null, default: null }
];

describe('validatePayload — partial mode (update semantics, B3)', () => {
  test('absent required field is skipped under partial', () => {
    // Only `name` provided; absent `id` must NOT raise "id is required".
    expect(validatePayload(struct, { name: 'x' }, { partial: true })).toEqual([]);
  });

  test('explicit null on a required field still errors under partial', () => {
    // null != undefined: writing null to a required column is rejected.
    expect(validatePayload(struct, { id: null }, { partial: true })).toContain('id is required');
  });

  test('a provided value is still type-checked under partial', () => {
    expect(validatePayload(struct, { age: 'abc' }, { partial: true })).toContain('age must be a number');
  });

  test('non-partial (create): an absent required field errors', () => {
    expect(validatePayload(struct, { name: 'x' })).toContain('id is required');
  });
});
