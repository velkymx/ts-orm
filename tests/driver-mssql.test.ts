import { describe, it, expect } from 'vitest';
import { createMssqlDriver } from '../src/drivers/mssql.js';
import { mssql } from '../src/dialect.js';

describe('mssql driver', () => {
  it('exposes the mssql dialect and the driver methods', () => {
    const driver = createMssqlDriver();
    expect(driver.dialect).toBe(mssql);
    expect(typeof driver.query).toBe('function');
    expect(typeof driver.execute).toBe('function');
    expect(typeof driver.close).toBe('function');
  });

  it('closes cleanly when no pool has been opened', async () => {
    const driver = createMssqlDriver();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
