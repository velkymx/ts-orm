import { describe, it, expect, afterEach } from 'vitest';
import { configure, getPool, closePool } from '../src/connection.js';

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
});
