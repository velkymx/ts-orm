import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();

const run = promisify(execFile);
const table = 'cli_probe';
const outFile = `./${table}.json`;

function conn() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
}

describe('CLI (vibeorm struct)', () => {
  beforeAll(async () => {
    // The CLI runs the compiled output, so ensure dist is current.
    execSync('npm run build', { stdio: 'ignore' });
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL)`);
    await c.end();
  });

  afterAll(async () => {
    const c = await conn();
    await c.execute(`DROP TABLE IF EXISTS ${table}`);
    await c.end();
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  });

  test('exits (does not hang) and writes the struct file', async () => {
    // The child inherits DB_* env so it connects to the same ephemeral MySQL.
    // timeout: if the process hangs (shared pool never closed) execFile kills it
    // and rejects -> the assertions below fail. A clean exit resolves fast.
    const { stdout } = await run('node', ['dist/cli.js', 'struct', table], {
      env: process.env,
      timeout: 20000
    });

    expect(stdout).toContain('Struct written');
    expect(fs.existsSync(outFile)).toBe(true);
    const struct = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(Array.isArray(struct)).toBe(true);
    expect(struct.some(f => f.name === 'name')).toBe(true);
  }, 30000);
});
