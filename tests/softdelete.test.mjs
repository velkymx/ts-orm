import { model } from '../src/model.js';
import mysql from 'mysql2/promise';

const table = 'sd_test';
const struct = [
  { name: 'id', type: 'number', required: false, length: null, default: 'auto_increment' },
  { name: 'name', type: 'string', required: true, length: 64, default: '' },
  { name: 'deleted_at', type: 'datetime', required: false, length: null, default: null }
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

describe('soft deletes', () => {
  beforeAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL, deleted_at DATETIME NULL)`);
    await c.end();
  });

  afterAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.end();
  });

  test('delete() soft-deletes; reads hide it; withTrashed/onlyTrashed/restore work', async () => {
    const M = model(table, struct, { softDelete: true });

    const created = await M.create({ name: 'x' });
    const id = created.data.id;
    expect((await M.all()).data.length).toBe(1);

    // Soft delete: row stays, deleted_at set.
    const del = await M.delete(id);
    expect(del.success).toBe(true);

    // Hidden from normal reads.
    expect((await M.all()).data.length).toBe(0);
    expect((await M.find(id)).success).toBe(false);

    // Still visible with withTrashed / onlyTrashed.
    expect((await M.withTrashed().get()).data.length).toBe(1);
    expect((await M.onlyTrashed().get()).data.length).toBe(1);

    // Restore brings it back into normal reads.
    const restored = await M.restore(id);
    expect(restored.success).toBe(true);
    expect((await M.all()).data.length).toBe(1);
    expect((await M.onlyTrashed().get()).data.length).toBe(0);
  });

  test('soft-delete scope is qualified to the base table under joins', async () => {
    const c = await conn();
    await c.execute('DROP TABLE IF EXISTS sd_orders');
    // Joined table ALSO has deleted_at — unqualified scope would be ambiguous.
    await c.execute('CREATE TABLE sd_orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, deleted_at DATETIME NULL)');
    await c.end();

    const M = model(table, struct, { softDelete: true });
    const res = await M.query().innerJoin('sd_orders', `${table}.id`, 'sd_orders.user_id').get();
    expect(res.success).toBe(true); // no "ambiguous column 'deleted_at'" error

    const c2 = await conn();
    await c2.execute('DROP TABLE IF EXISTS sd_orders');
    await c2.end();
  });

  test('softDelete requires the deleted_at column in the struct', () => {
    const noCol = [
      { name: 'id', type: 'number', required: false, length: null, default: 'auto_increment' },
      { name: 'name', type: 'string', required: true, length: 64, default: '' }
    ];
    expect(() => model(table, noCol, { softDelete: true })).toThrow(/deleted_at/);
  });

  test('without softDelete, delete() is a hard delete', async () => {
    const M = model(table, struct); // no softDelete
    const created = await M.create({ name: 'hard' });
    await M.delete(created.data.id);
    // Even withTrashed-style raw query: the row is gone.
    const raw = await M.query().where('id', created.data.id).get();
    expect(raw.data.length).toBe(0);
  });
});
