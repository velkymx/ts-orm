import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import type { OrmResponse } from './QueryBuilder.js';

// Load environment once for the whole package. quiet:true suppresses dotenv 17's
// startup tips. No other module should call dotenv.config() again.
dotenv.config({ quiet: true });

// Single shared connection pool. mysql2 recommends reusing one pool across
// modules: connections are created on demand (so idle cost is bounded), and
// pool.execute()'s prepared-statement LRU cache is shared, so identical SQL is
// prepared once instead of once per pool.
export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    // Honor a configurable port; falls back to MySQL's default 3306 when unset.
    // Required so the suite can target an ephemeral mysqld on a random port.
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

// Standard envelope returned by every data operation.
export function formatResponse(success: boolean, message: string, data: unknown = null): OrmResponse {
    return { success, message, data };
}
