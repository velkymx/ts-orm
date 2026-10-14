import { describe, it, expect, afterEach } from 'vitest';
import { OrmError, sanitizeError, setLogger, resetLogger } from '../src/errors.js';

afterEach(() => resetLogger());

describe('sanitizeError', () => {
  it('maps a normalized code to a safe client message', () => {
    expect(sanitizeError(new OrmError('duplicate'), 'create')).toBe('Record already exists');
    expect(sanitizeError(new OrmError('foreign_key'), 'remove')).toBe(
      'Related record constraint failed',
    );
    expect(sanitizeError(new OrmError('not_null'), 'create')).toBe('A required field was missing');
  });

  it('returns a generic message for unknown or non-OrmError input', () => {
    expect(sanitizeError(new OrmError('unknown'), 'read')).toBe('Database operation failed');
    expect(sanitizeError(new Error('raw driver detail'), 'read')).toBe('Database operation failed');
  });

  it('logs full detail server-side without leaking it to the caller', () => {
    const logged: unknown[] = [];
    setLogger((message, detail) => logged.push({ message, detail }));
    const raw = new Error('users.email UNIQUE constraint; schema leak');
    const safe = sanitizeError(new OrmError('duplicate', raw), 'create');
    expect(safe).toBe('Record already exists');
    expect(safe).not.toContain('schema leak');
    expect(logged).toHaveLength(1);
  });
});
