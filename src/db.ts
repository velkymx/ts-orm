import mysql from 'mysql2/promise';
import type { PoolOptions } from 'mysql2';
import dotenv from 'dotenv';
import type { OrmResponse } from './QueryBuilder.js';

// Load environment once for the whole package. quiet:true suppresses dotenv 17's
// startup tips. No other module should call dotenv.config() again.
dotenv.config({ quiet: true });

// Resolve the optional TLS setting from DB_SSL. Managed engines (RDS, Aurora)
// usually require TLS; MariaDB/self-hosted may not.
//   unset        -> no TLS
//   'Amazon RDS' -> mysql2's bundled RDS CA bundle (verified)
//   'no-verify'  -> TLS without cert verification (self-signed)
//   anything else (e.g. 'true') -> verified TLS
function resolveSsl(): PoolOptions['ssl'] {
    const s = process.env.DB_SSL;
    if (!s) return undefined;
    if (s === 'Amazon RDS') return 'Amazon RDS';
    if (s === 'no-verify') return { rejectUnauthorized: false };
    return { rejectUnauthorized: true };
}

// Build the pool options from the environment. Works for any MySQL-wire engine —
// MySQL, MariaDB, RDS/Aurora-MySQL — via host/port/credentials (+ optional TLS).
export function buildPoolConfig(): PoolOptions {
    const ssl = resolveSsl();
    return {
        host: process.env.DB_HOST,
        // Configurable port; defaults to MySQL's 3306 when unset (also lets the
        // suite target an ephemeral server on a random port).
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        ...(ssl ? { ssl } : {})
    };
}

// Single shared connection pool. mysql2 recommends reusing one pool across
// modules: connections are created on demand (so idle cost is bounded), and
// pool.execute()'s prepared-statement LRU cache is shared, so identical SQL is
// prepared once instead of once per pool.
export const pool = mysql.createPool(buildPoolConfig());

// Standard envelope returned by every data operation.
export function formatResponse(success: boolean, message: string, data: unknown = null): OrmResponse {
    return { success, message, data };
}

// Build the `LIMIT x OFFSET y` fragment. `!= null` honors an explicit 0. MySQL
// requires LIMIT before OFFSET, so an offset without a limit gets the documented
// max-row sentinel (2^64 - 1). Shared by orm.read/readWith and QueryBuilder.
export function limitOffsetClause(limit: number | null, offset: number | null): string {
    const limitSql = limit != null ? `LIMIT ${limit}` : '';
    const offsetSql = offset != null
        ? (limit != null ? `OFFSET ${offset}` : `LIMIT 18446744073709551615 OFFSET ${offset}`)
        : '';
    return `${limitSql} ${offsetSql}`.trim();
}

// Reduce a multi-row result envelope to a single-record one: the first row, or a
// not-found / failed envelope. Shared by orm.readOne and QueryBuilder.first().
export function firstRow(result: OrmResponse): OrmResponse {
    if (!result.success || !Array.isArray(result.data)) {
        return formatResponse(false, 'Query failed');
    }
    if (result.data.length === 0) {
        return formatResponse(false, 'Record not found');
    }
    return formatResponse(true, 'Record found', result.data[0]);
}
