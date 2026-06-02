import { buildPoolConfig } from '../src/db.js';

describe('buildPoolConfig — managed MySQL / TLS', () => {
  let savedSsl;
  let savedPort;
  beforeEach(() => {
    savedSsl = process.env.DB_SSL;
    savedPort = process.env.DB_PORT;
  });
  afterEach(() => {
    if (savedSsl === undefined) delete process.env.DB_SSL; else process.env.DB_SSL = savedSsl;
    if (savedPort === undefined) delete process.env.DB_PORT; else process.env.DB_PORT = savedPort;
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
});
