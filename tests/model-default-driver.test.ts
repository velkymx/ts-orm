import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineStruct } from '../src/struct.js';
import { defineModel } from '../src/model.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import { getDefaultDriver, resetDefaultDriver } from '../src/default-driver.js';

const savedDialect = process.env['DB_DIALECT'];
const savedFile = process.env['DB_FILE'];

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

beforeEach(() => {
  resetDefaultDriver();
  process.env['DB_DIALECT'] = 'sqlite';
  process.env['DB_FILE'] = ':memory:';
});

afterEach(() => {
  resetDefaultDriver();
  if (savedDialect === undefined) delete process.env['DB_DIALECT'];
  else process.env['DB_DIALECT'] = savedDialect;
  if (savedFile === undefined) delete process.env['DB_FILE'];
  else process.env['DB_FILE'] = savedFile;
});

describe('defineModel driver binding', () => {
  it('uses the shared environment driver when given only a struct', async () => {
    const M = defineModel(User);
    expect(M.boundDriver).toBe(getDefaultDriver());
    expect(M.boundDriver.dialect.name).toBe('sqlite');
  });

  it('memoizes one default across models', () => {
    expect(defineModel(User).boundDriver).toBe(defineModel(User).boundDriver);
  });

  it('prefers an explicit driver in either position', () => {
    const explicit = createSqliteDriver({ filename: ':memory:' });
    expect(defineModel(User, explicit).boundDriver).toBe(explicit);
    expect(defineModel(explicit, User).boundDriver).toBe(explicit);
  });

  it('reads through the default binding with no driver anywhere', async () => {
    const M = defineModel(User);
    await M.boundDriver.execute(
      'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)',
      [],
    );
    await M.boundDriver.execute('INSERT INTO "users" ("name") VALUES (?)', ['Ada']);
    const user = await M.find(1);
    expect(user?.toRow().name).toBe('Ada');
    expect(await M.find(999)).toBeNull();
    await M.boundDriver.close();
  });
});
