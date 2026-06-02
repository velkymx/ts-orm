import { buildPoolConfig, ping } from '../src/db.js';
import { setLogger, createConsoleLogger } from '../src/logger.js';

describe('buildPoolConfig — managed MySQL / TLS', () => {
  const keys = ['DB_SSL', 'DB_PORT', 'DB_CONNECTION_LIMIT', 'DB_CONNECT_TIMEOUT'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  test('defaults to port 3306 and no TLS', () => {
    delete process.env.DB_PORT;
    delete process.env.DB_SSL;
    const cfg = buildPoolConfig();
    expect(cfg.port).toBe(3306);
    expect(cfg.ssl).toBeUndefined();
  });

  test('honors DB_PORT', () => {
    process.env.DB_PORT = '3307';
    expect(buildPoolConfig().port).toBe(3307);
  });

  test('DB_SSL=true enables verified TLS', () => {
    process.env.DB_SSL = 'true';
    expect(buildPoolConfig().ssl).toEqual({ rejectUnauthorized: true });
  });

  test("DB_SSL='Amazon RDS' uses mysql2's bundled RDS CA profile", () => {
    process.env.DB_SSL = 'Amazon RDS';
    expect(buildPoolConfig().ssl).toBe('Amazon RDS');
  });

  test('DB_SSL=no-verify allows self-signed certs', () => {
    process.env.DB_SSL = 'no-verify';
    expect(buildPoolConfig().ssl).toEqual({ rejectUnauthorized: false });
  });

  test('connection tuning is omitted by default (mysql2 defaults apply)', () => {
    delete process.env.DB_CONNECTION_LIMIT;
    delete process.env.DB_CONNECT_TIMEOUT;
    const cfg = buildPoolConfig();
    expect(cfg.connectionLimit).toBeUndefined();
    expect(cfg.connectTimeout).toBeUndefined();
  });

  test('DB_CONNECTION_LIMIT / DB_CONNECT_TIMEOUT are applied when valid', () => {
    process.env.DB_CONNECTION_LIMIT = '5';
    process.env.DB_CONNECT_TIMEOUT = '2000';
    const cfg = buildPoolConfig();
    expect(cfg.connectionLimit).toBe(5);
    expect(cfg.connectTimeout).toBe(2000);
  });

  test('invalid tuning values are ignored', () => {
    process.env.DB_CONNECTION_LIMIT = 'abc';
    process.env.DB_CONNECT_TIMEOUT = '0';
    const cfg = buildPoolConfig();
    expect(cfg.connectionLimit).toBeUndefined();
    expect(cfg.connectTimeout).toBeUndefined();
  });

  test('warns when required DB config (DB_HOST/DB_DATABASE) is missing', () => {
    const savedHost = process.env.DB_HOST;
    delete process.env.DB_HOST;
    const warns = [];
    setLogger({ debug() {}, info() {}, warn(msg) { warns.push(msg); }, error() {} });

    buildPoolConfig();
    expect(warns.length).toBeGreaterThan(0);

    if (savedHost === undefined) delete process.env.DB_HOST; else process.env.DB_HOST = savedHost;
    setLogger(createConsoleLogger());
  });

  test('does not warn when config is present', () => {
    const warns = [];
    setLogger({ debug() {}, info() {}, warn(msg) { warns.push(msg); }, error() {} });
    buildPoolConfig(); // DB_HOST/DB_DATABASE set by the harness
    expect(warns.length).toBe(0);
    setLogger(createConsoleLogger());
  });

  test('ping() returns true when the database is reachable', async () => {
    expect(await ping()).toBe(true);
  });
});
