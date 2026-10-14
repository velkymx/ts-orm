import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../src/config.js';

const KEYS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE', 'DB_PORT'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveConfig', () => {
  it('reads a full config from the environment', () => {
    process.env.DB_HOST = 'db.local';
    process.env.DB_USER = 'root';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_DATABASE = 'app';
    process.env.DB_PORT = '3307';

    expect(resolveConfig()).toEqual({
      host: 'db.local',
      user: 'root',
      password: 'secret',
      database: 'app',
      port: 3307,
    });
  });

  it('lets explicit overrides win over the environment', () => {
    process.env.DB_HOST = 'env-host';
    process.env.DB_USER = 'root';
    process.env.DB_DATABASE = 'app';

    const cfg = resolveConfig({ host: 'override-host' });
    expect(cfg.host).toBe('override-host');
    expect(cfg.user).toBe('root');
  });

  it('defaults password to empty and port to 3306', () => {
    process.env.DB_HOST = 'h';
    process.env.DB_USER = 'u';
    process.env.DB_DATABASE = 'd';

    const cfg = resolveConfig();
    expect(cfg.password).toBe('');
    expect(cfg.port).toBe(3306);
  });

  it('throws listing every missing required key', () => {
    expect(() => resolveConfig()).toThrow(/DB_HOST.*DB_USER.*DB_DATABASE/s);
  });

  it('rejects non-numeric and out-of-range ports naming the value', () => {
    process.env.DB_HOST = 'h';
    process.env.DB_USER = 'u';
    process.env.DB_DATABASE = 'd';
    process.env.DB_PORT = 'notaport';
    expect(() => resolveConfig()).toThrow(/port.*notaport/i);
    process.env.DB_PORT = '99999';
    expect(() => resolveConfig()).toThrow(/port/i);
    delete process.env.DB_PORT;
    expect(() => resolveConfig({ port: Number.NaN })).toThrow(/port/i);
  });
});
