import { setLogger, createConsoleLogger } from '../src/logger.js';
import { read } from '../src/orm.js';
import mysql from 'mysql2/promise';

const table = 'ql_test';

function conn() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
}

describe('query logging (runQuery)', () => {
  let savedSlow;

  beforeAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(32))`);
    await c.execute(`INSERT INTO ${table} (name) VALUES ('a')`);
    await c.end();
  });

  afterAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.end();
  });

  beforeEach(() => { savedSlow = process.env.DB_SLOW_QUERY_MS; });
  afterEach(() => {
    if (savedSlow === undefined) delete process.env.DB_SLOW_QUERY_MS; else process.env.DB_SLOW_QUERY_MS = savedSlow;
    setLogger(createConsoleLogger());
  });

  test('logs the SQL at debug level on every query', async () => {
    const debugs = [];
    setLogger({ debug(_m, meta) { debugs.push(meta); }, info() {}, warn() {}, error() {} });

    await read(table);

    expect(debugs.some(m => typeof m?.sql === 'string' && /SELECT/i.test(m.sql))).toBe(true);
  });

  test('warns on a slow query when over the threshold', async () => {
    // Tiny threshold so any real query counts as slow.
    process.env.DB_SLOW_QUERY_MS = '0.0001';
    const warns = [];
    setLogger({ debug() {}, info() {}, warn(_m, meta) { warns.push(meta); }, error() {} });

    await read(table);

    expect(warns.some(m => /SELECT/i.test(m?.sql) && typeof m.durationMs === 'number')).toBe(true);
  });
});
