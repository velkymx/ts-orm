import { describe, it, expect, afterEach } from 'vitest';
import { configure, getPool, closePool } from '../src/connection.js';
import { setLogger, resetLogger } from '../src/errors.js';

afterEach(async () => {
  await closePool();
});

describe('connection manager', () => {
  it('creates a pool lazily from injected config', () => {
    configure({ host: 'localhost', user: 'u', password: '', database: 'd' });
    const pool = getPool();
    expect(typeof pool.query).toBe('function');
  });

  it('returns the same pool instance on repeated calls', () => {
    configure({ host: 'localhost', user: 'u', password: '', database: 'd' });
    expect(getPool()).toBe(getPool());
  });

  it('creates a fresh pool after closePool', async () => {
    configure({ host: 'localhost', user: 'u', password: '', database: 'd' });
    const first = getPool();
    await closePool();
    const second = getPool();
    expect(second).not.toBe(first);
  });

  it('logs shutdown failures on reconfigure instead of rejecting unobserved', async () => {
    configure({ host: 'localhost', user: 'u', password: '', database: 'd' });
    const first = getPool();
    const logged: unknown[] = [];
    setLogger((_message, detail) => logged.push(detail));
    const failure = new Error('shutdown boom');
    (first as unknown as { end: () => Promise<void> }).end = async () => {
      throw failure;
    };
    try {
      configure({ host: 'other', user: 'u', password: '', database: 'd' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(logged).toContain(failure);
      expect(getPool()).not.toBe(first);
    } finally {
      resetLogger();
    }
  });
});
