import { pool, close, ping } from '../src/db.js';

// Isolated in its own file: close() ends the shared pool, so this must be the
// only test using that pool. Other test files run in separate workers with their
// own pool, so this does not affect them.
describe('close (graceful shutdown)', () => {
  test('ends the pool so subsequent queries fail', async () => {
    // Open a real connection first so we prove the pool is actually torn down.
    await pool.query('SELECT 1');
    await close();
    await expect(pool.query('SELECT 1')).rejects.toThrow(/closed/i);
    // Health check reports unreachable once the pool is closed.
    expect(await ping()).toBe(false);
    // close() is idempotent — a second call must not throw.
    await expect(close()).resolves.toBeUndefined();
  });
});
