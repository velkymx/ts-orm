import { describe, it, expect } from 'vitest';
import { createMysqlDriver } from '../src/drivers/mysql.js';
import { mysql } from '../src/dialect.js';

describe('mysql driver', () => {
  it('exposes the mysql dialect and the driver methods', () => {
    const driver = createMysqlDriver();
    expect(driver.dialect).toBe(mysql);
    expect(typeof driver.query).toBe('function');
    expect(typeof driver.execute).toBe('function');
    expect(typeof driver.close).toBe('function');
  });

  it('closes cleanly when no pool has been opened', async () => {
    const driver = createMysqlDriver();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
