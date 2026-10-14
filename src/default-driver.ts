/**
 * Zero-argument default driver. Picks the engine from `DB_DIALECT`
 * (mysql, postgres, sqlite, or mssql; defaults to mysql) and returns a
 * lazy factory product, so importing plus env is the whole setup and no
 * connection opens at creation. Unknown values throw listing support.
 * Lives here instead of `driver.ts` so the type contract stays a leaf
 * with no runtime imports of engines or optional peers.
 */

import type { Driver } from './driver.js';
import { createMssqlDriver } from './drivers/mssql.js';
import { createMysqlDriver } from './drivers/mysql.js';
import { createPostgresDriver } from './drivers/postgres.js';
import { createSqliteDriver } from './drivers/sqlite.js';

export function createDefaultDriver(): Driver {
  switch ((process.env['DB_DIALECT'] ?? 'mysql').toLowerCase()) {
    case 'mysql':
      return createMysqlDriver();
    case 'postgres':
      return createPostgresDriver();
    case 'sqlite':
      return createSqliteDriver();
    case 'mssql':
      return createMssqlDriver();
    default:
      throw new Error(
        `Unsupported DB_DIALECT "${process.env['DB_DIALECT']}": expected mysql, postgres, sqlite, or mssql`,
      );
  }
}
