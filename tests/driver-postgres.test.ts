import { describe, it, expect } from 'vitest';
import { createPostgresDriver } from '../src/drivers/postgres.js';
import { postgres } from '../src/dialect.js';

describe('postgres driver', () => {
  it('exposes the postgres dialect and the driver methods', () => {
    const driver = createPostgresDriver();
    expect(driver.dialect).toBe(postgres);
    expect(typeof driver.query).toBe('function');
    expect(typeof driver.execute).toBe('function');
    expect(typeof driver.close).toBe('function');
  });

  it('closes cleanly when no pool has been opened', async () => {
    const driver = createPostgresDriver();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
