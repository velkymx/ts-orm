import { withTransaction } from '../src/db.js';
import { create, read } from '../src/orm.js';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const table = 'tx_test';
const struct = [
  { name: 'id', type: 'number', required: false, length: null, default: 'auto_increment' },
  { name: 'name', type: 'string', required: true, length: 64, default: '' }
];

function conn() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
}

describe('withTransaction', () => {
  beforeAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL)`);
    await c.end();
  });

  afterAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.end();
  });

  test('commits on success', async () => {
    await withTransaction(async () => {
      await create(table, struct, { name: 'committed' });
    });
    const res = await read(table, { name: 'committed' });
    expect(res.data.length).toBe(1);
  });

  test('rolls back on throw (no partial write persists)', async () => {
    await expect(withTransaction(async () => {
      await create(table, struct, { name: 'rolledback' });
      // Force failure after the insert — the row must not survive.
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const res = await read(table, { name: 'rolledback' });
    expect(res.data.length).toBe(0);
  });

  test('reads inside the transaction see its own uncommitted writes', async () => {
    await withTransaction(async () => {
      await create(table, struct, { name: 'inside' });
      // Same connection via AsyncLocalStorage -> sees the uncommitted insert.
      const seen = await read(table, { name: 'inside' });
      expect(seen.data.length).toBe(1);
    });
  });

  test('nested withTransaction joins the outer transaction (rolls back together)', async () => {
    await expect(withTransaction(async () => {
      await create(table, struct, { name: 'outer' });
      await withTransaction(async () => {
        await create(table, struct, { name: 'innerNested' });
      });
      throw new Error('outer-fail');
    })).rejects.toThrow('outer-fail');

    const outer = await read(table, { name: 'outer' });
    const inner = await read(table, { name: 'innerNested' });
    expect(outer.data.length).toBe(0);
    expect(inner.data.length).toBe(0);
  });
});
