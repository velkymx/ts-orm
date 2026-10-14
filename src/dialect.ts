/**
 * Per-engine SQL differences, isolated to one place. Everything else in the
 * query layer is engine-agnostic; only identifier quoting, parameter markers,
 * row-limiting syntax, and the new-row-id strategy actually vary.
 */

export type DialectName = 'mysql' | 'postgres' | 'sqlite' | 'mssql';

/** How an engine reports the id of an inserted row. */
export type InsertIdStrategy = 'driver' | 'returning' | 'output';

export interface Dialect {
  readonly name: DialectName;
  /** Quote an identifier. Callers validate the name before quoting. */
  quoteIdent(name: string): string;
  /** Render the 1-based parameter marker for a bound value. */
  placeholder(index: number): string;
  /** Render the row-limiting clause, or empty string when unbounded. */
  limitOffset(limit?: number, offset?: number): string;
  readonly insertIdStrategy: InsertIdStrategy;
}

/** LIMIT/OFFSET shared by MySQL, Postgres, and SQLite. Offset implies a limit. */
function standardLimitOffset(limit?: number, offset?: number): string {
  if (limit == null) return '';
  return offset == null ? `LIMIT ${limit}` : `LIMIT ${limit} OFFSET ${offset}`;
}

export const mysql: Dialect = {
  name: 'mysql',
  quoteIdent: (name) => `\`${name}\``,
  placeholder: () => '?',
  limitOffset: standardLimitOffset,
  insertIdStrategy: 'driver',
};

export const postgres: Dialect = {
  name: 'postgres',
  quoteIdent: (name) => `"${name}"`,
  placeholder: (index) => `$${index}`,
  limitOffset: standardLimitOffset,
  insertIdStrategy: 'returning',
};

export const sqlite: Dialect = {
  name: 'sqlite',
  quoteIdent: (name) => `"${name}"`,
  placeholder: () => '?',
  limitOffset: standardLimitOffset,
  insertIdStrategy: 'driver',
};

export const mssql: Dialect = {
  name: 'mssql',
  quoteIdent: (name) => `[${name}]`,
  placeholder: (index) => `@p${index}`,
  // SQL Server pages with OFFSET/FETCH, which the caller must pair with ORDER BY.
  limitOffset: (limit, offset) => {
    if (limit == null) return '';
    return `OFFSET ${offset ?? 0} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  },
  insertIdStrategy: 'output',
};
