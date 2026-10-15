/**
 * Database configuration. Resolved from the environment with optional explicit
 * overrides, and validated up front so a missing setting fails with a clear
 * message instead of surfacing later as an opaque connection error. Importing
 * this module loads `.env` once via dotenv (which never overrides already
 * set variables); every engine's config path reads through here, so all
 * drivers pick up file settings with no manual bootstrap.
 */

import 'dotenv/config';

export interface DbConfig {
  readonly host: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly port?: number;
}

const DEFAULT_PORT = 3306;

/**
 * Merge environment variables with explicit overrides and validate the result.
 * `host`, `user`, and `database` are required; `password` defaults to empty and
 * `port` to 3306. Throws listing every missing required key.
 */
export function resolveConfig(overrides: Partial<DbConfig> = {}): DbConfig {
  const host = overrides.host ?? process.env.DB_HOST;
  const user = overrides.user ?? process.env.DB_USER;
  const database = overrides.database ?? process.env.DB_DATABASE;
  const password = overrides.password ?? process.env.DB_PASSWORD ?? '';
  const socket = host !== undefined && host.startsWith('/');
  const rawPort = overrides.port ?? (process.env.DB_PORT ? Number(process.env.DB_PORT) : socket ? undefined : DEFAULT_PORT);
  if (rawPort !== undefined && (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535)) {
    const seen = overrides.port ?? process.env.DB_PORT;
    throw new Error(`Invalid database port "${seen}": expected an integer 1-65535`);
  }
  const port = rawPort;

  const missing: string[] = [];
  if (!host) missing.push('DB_HOST');
  if (!user) missing.push('DB_USER');
  if (!database) missing.push('DB_DATABASE');

  if (missing.length > 0) {
    throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
  }

  return { host: host!, user: user!, password, database: database!, ...(port === undefined ? {} : { port }) };
}
