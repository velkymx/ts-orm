import { describe, it, expect } from 'vitest';
import {
  isValidUUID,
  isValidDatetime,
  isValidDate,
  isValidBoolean,
} from '../src/validation.js';

describe('isValidUUID', () => {
  it('accepts a v4 UUID in either case', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects non-v4, malformed, or non-string input', () => {
    expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // v1
    expect(isValidUUID('550e8400-e29b-41d4-c716-446655440000')).toBe(false); // bad variant
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID(123 as unknown as string)).toBe(false);
  });
});

describe('isValidDatetime', () => {
  it('accepts a well-formed in-range datetime', () => {
    expect(isValidDatetime('2026-10-13 14:30:00')).toBe(true);
  });

  it('rejects wrong format, impossible calendar dates, and out-of-range parts', () => {
    expect(isValidDatetime('2026-10-13T14:30:00')).toBe(false); // T separator
    expect(isValidDatetime('2026-02-30 00:00:00')).toBe(false); // Feb 30
    expect(isValidDatetime('2026-13-01 00:00:00')).toBe(false); // month 13
    expect(isValidDatetime('2026-10-13 25:00:00')).toBe(false); // hour 25
    expect(isValidDatetime(0 as unknown as string)).toBe(false);
  });
});

describe('isValidDate', () => {
  it('accepts a well-formed in-range date', () => {
    expect(isValidDate('2026-10-13')).toBe(true);
  });

  it('rejects wrong format and impossible calendar dates', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false); // month 0
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026/10/13')).toBe(false);
    expect(isValidDate(null as unknown as string)).toBe(false);
  });
});

describe('isValidBoolean', () => {
  it('accepts booleans and 0/1 in number or string form', () => {
    expect(isValidBoolean(true)).toBe(true);
    expect(isValidBoolean(false)).toBe(true);
    expect(isValidBoolean(0)).toBe(true);
    expect(isValidBoolean(1)).toBe(true);
    expect(isValidBoolean('0')).toBe(true);
    expect(isValidBoolean('1')).toBe(true);
  });

  it('rejects other values', () => {
    expect(isValidBoolean(2)).toBe(false);
    expect(isValidBoolean('true')).toBe(false);
    expect(isValidBoolean(null)).toBe(false);
    expect(isValidBoolean(undefined)).toBe(false);
  });
});
