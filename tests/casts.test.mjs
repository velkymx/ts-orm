import { model } from '../src/model.js';
import mysql from 'mysql2/promise';

const table = 'cast_test';
const struct = [
  { name: 'id', type: 'number', required: false, length: null, default: 'auto_increment' },
  { name: 'active', type: 'boolean', required: false, length: 1, default: null },
  { name: 'meta', type: 'json', required: false, length: null, default: null }
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

describe('casts (boolean / json)', () => {
  beforeAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, active TINYINT(1), meta JSON)`);
    await c.end();
  });

  afterAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.end();
  });

  test('create casts on write, find casts on read (boolean + json round-trip)', async () => {
    const M = model(table, struct);
    const created = await M.create({ active: true, meta: { a: 1, b: [2, 3] } });
    expect(created.success).toBe(true);

    const r = await M.find(created.data.id);
    expect(r.success).toBe(true);
    expect(typeof r.data.active).toBe('boolean');
    expect(r.data.active).toBe(true);
    expect(r.data.meta).toEqual({ a: 1, b: [2, 3] }); // parsed object, not a string
  });

  test('QueryBuilder.get casts rows too', async () => {
    const M = model(table, struct);
    await M.create({ active: false, meta: { x: 1 } });
    const res = await M.query().get();
    expect(res.success).toBe(true);
    expect(res.data.every(row => row.active === null || typeof row.active === 'boolean')).toBe(true);
    expect(res.data.every(row => row.meta === null || typeof row.meta === 'object')).toBe(true);
  });
});
