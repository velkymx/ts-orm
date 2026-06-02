import mysql from 'mysql2/promise';
import type { PoolOptions, ExecuteValues, QueryResult, FieldPacket } from 'mysql2';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';
import { getLogger } from './logger.js';
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
    // Optional pool tuning. Only applied when a positive, finite value is given;
    // otherwise mysql2's defaults stand (connectionLimit 10, no connect timeout).
    const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT);
    const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT);
    return {
        host: process.env.DB_HOST,
        // Configurable port; defaults to MySQL's 3306 when unset (also lets the
        // suite target an ephemeral server on a random port).
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        ...(ssl ? { ssl } : {}),
        ...(Number.isFinite(connectionLimit) && connectionLimit > 0 ? { connectionLimit } : {}),
        ...(Number.isFinite(connectTimeout) && connectTimeout > 0 ? { connectTimeout } : {})
    };
}

// Single shared connection pool. mysql2 recommends reusing one pool across
// modules: connections are created on demand (so idle cost is bounded), and
// pool.execute()'s prepared-statement LRU cache is shared, so identical SQL is
// prepared once instead of once per pool.
export const pool = mysql.createPool(buildPoolConfig());

/**
 * Health check: acquire a pooled connection and ping it. Returns true when the
 * database is reachable, false on any error (closed pool, network, auth). Useful
 * for readiness/liveness probes.
 */
export async function ping(): Promise<boolean> {
    try {
        const conn = await pool.getConnection();
        try {
            await conn.ping();
            return true;
        } finally {
            conn.release();
        }
    } catch {
        return false;
    }
}

/**
 * Close the shared pool for graceful shutdown (e.g. on SIGTERM/SIGINT). Without
 * this the pool's open connections keep the event loop alive and the process
 * hangs on exit.
 */
export async function close(): Promise<void> {
    await pool.end();
}

// Holds the active transaction connection for the current async context.
// Empty outside a transaction.
const txStore = new AsyncLocalStorage<PoolConnection>();

// The executor every data op runs against: the transaction connection when
// inside withTransaction(), otherwise the shared pool. Pool and PoolConnection
// expose the same execute() signature, so callers need no change.
export function executor(): Pool | PoolConnection {
    return txStore.getStore() ?? pool;
}

/**
 * Single execution path for every query. Logs the SQL at debug level, times it,
 * and warns when it exceeds DB_SLOW_QUERY_MS (disabled when unset/0). Only the
 * SQL text is logged — never the bound parameters (PII-safe). This is also the
 * one place the caller-supplied params are cast to mysql2's ExecuteValues.
 */
export async function runQuery(sql: string, params: unknown[] = []): Promise<[QueryResult, FieldPacket[]]> {
    const log = getLogger();
    log.debug('query', { sql });

    const start = performance.now();
    const [rows, fields] = await executor().execute(sql, params as ExecuteValues[]);
    const durationMs = performance.now() - start;

    // Read the threshold per call so it can be tuned at runtime; 0/unset disables.
    const slowMs = Number(process.env.DB_SLOW_QUERY_MS) || 0;
    if (slowMs > 0 && durationMs >= slowMs) {
        log.warn('slow query', { sql, durationMs: Math.round(durationMs) });
    }

    return [rows, fields];
}

/**
 * Run `fn` inside a single transaction. Every model/QueryBuilder/orm op invoked
 * within `fn` automatically uses the transaction connection (via executor()).
 * Commits if `fn` resolves, rolls back if it throws (re-throwing the error).
 * Nested calls join the outer transaction — no nested BEGIN/COMMIT.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    // Already in a transaction: reuse the same connection, let the outer call
    // own commit/rollback.
    if (txStore.getStore()) {
        return fn();
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await txStore.run(conn, fn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// Standard envelope returned by every data operation.
export function formatResponse(success: boolean, message: string, data: unknown = null): OrmResponse {
    return { success, message, data };
}

// Build the `LIMIT x OFFSET y` fragment. `!= null` honors an explicit 0. MySQL
// requires LIMIT before OFFSET, so an offset without a limit gets the documented
// max-row sentinel (2^64 - 1). Shared by orm.read/readWith and QueryBuilder.
export function limitOffsetClause(limit: number | null, offset: number | null): string {
    // Treat non-finite values (e.g. parseInt('abc') -> NaN) as absent so a bad
    // input is ignored rather than emitting `LIMIT NaN` (a SQL error).
    const hasLimit = limit != null && Number.isFinite(limit);
    const hasOffset = offset != null && Number.isFinite(offset);
    const limitSql = hasLimit ? `LIMIT ${limit}` : '';
    const offsetSql = hasOffset
        ? (hasLimit ? `OFFSET ${offset}` : `LIMIT 18446744073709551615 OFFSET ${offset}`)
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
