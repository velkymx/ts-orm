import { pool, close } from '../src/db.js';

// Isolated in its own file: close() ends the shared pool, so this must be the
// only test using that pool. Other test files run in separate workers with their
// own pool, so this does not affect them.
describe('close (graceful shutdown)', () => {
  test('ends the pool so subsequent queries fail', async () => {
    // Open a real connection first so we prove the pool is actually torn down.
    await pool.query('SELECT 1');
    await close();
    await expect(pool.query('SELECT 1')).rejects.toThrow();
  });
});
