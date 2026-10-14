import { describe, it, expect } from 'vitest';
import { create as simpleCreate, read as simpleRead, readOne as simpleReadOne, update as simpleUpdate, remove as simpleRemove } from '../src/simple.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { createMysqlDriver } from '../src/drivers/mysql.js';
import type { NamedFieldDef } from '../src/simple.js';

const USER_FIELDS: NamedFieldDef[] = [
  { name: 'id', type: 'string', required: true, length: 36, default: '' },
  { name: 'name', type: 'string', required: true, length: 128, default: '' },
  { name: 'email', type: 'string', required: true, length: 256, default: '' },
  { name: 'created_at', type: 'datetime', required: true, default: 'current_timestamp' },
];

async function setup() {
  const driver = createSqliteDriver({ filename: ':memory:' });
  await driver.execute(
    'CREATE TABLE "users" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT, "created_at" TEXT)',
    [],
  );
  return driver;
}

const BERTHA = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Bertha',
  email: 'bertha@example.com',
  created_at: '2025-04-07 10:00:00',
};

describe('simple facade (issue 96)', () => {
  it('creates and reads back with no struct or model setup', async () => {
    const driver = await setup();
    const created = await simpleCreate('users', USER_FIELDS, BERTHA, driver);
    expect(created.success).toBe(true);
    const found = await simpleReadOne('users', { id: BERTHA.id }, driver);
    expect(found.success && found.data).toMatchObject({ name: 'Bertha' });
    await driver.close();
  });

  it('returns validation failure instead of throwing', async () => {
    const driver = await setup();
    const { name: _dropped, ...missing } = BERTHA;
    const result = await simpleCreate('users', USER_FIELDS, missing, driver);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/Validation failed/);
    }
    await driver.close();
  });

  it('reads, updates, and removes by key', async () => {
    const driver = await setup();
    await simpleCreate('users', USER_FIELDS, BERTHA, driver);
    await simpleCreate('users', USER_FIELDS, { ...BERTHA, id: '223e4567-e89b-12d3-a456-426614174000', name: 'Ada' }, driver);
    const all = await simpleRead('users', {}, {}, driver);
    expect(all.success ? all.data.length : -1).toBe(2);
    const updated = await simpleUpdate(
      'users',
      USER_FIELDS,
      { id: BERTHA.id, name: 'Bertha Jones' },
      'id',
      driver,
    );
    expect(updated.success).toBe(true);
    const removed = await simpleRemove('users', 'id', BERTHA.id, driver);
    expect(removed.success && removed.data.affectedRows).toBe(1);
    await driver.close();
  });
});

const LIVE = process.env['TS_ORM_TEST_MYSQL'] === '1';

describe.runIf(LIVE)('simple facade live default driver (issue 96)', () => {
  it('creates over the default pool with zero setup', async () => {
    const driver = createMysqlDriver();
    await driver.execute('DROP TABLE IF EXISTS `facade_probe`', []);
    await driver.execute(
      'CREATE TABLE `facade_probe` (`id` INT AUTO_INCREMENT PRIMARY KEY, `name` VARCHAR(50))',
      [],
    );
    const fields: NamedFieldDef[] = [
      { name: 'id', type: 'number', required: true, default: 'auto_increment' },
      { name: 'name', type: 'string', required: true, length: 50 },
    ];
    const created = await simpleCreate('facade_probe', fields, { name: 'zero-setup' });
    expect(created.success).toBe(true);
    const found = await simpleReadOne('facade_probe', { name: 'zero-setup' });
    expect(found.success && found.data).toMatchObject({ name: 'zero-setup' });
    await driver.execute('DROP TABLE `facade_probe`', []);
    await driver.close();
  });
});
