import { createDB } from 'mysql-memory-server';

// The package does not re-export its server type from the root, so derive it
// from createDB's return value instead of a brittle deep import.
type MySQLDB = Awaited<ReturnType<typeof createDB>>;

// Holds the running server so teardown can stop it after the suite finishes.
let db: MySQLDB | undefined;

/**
 * Vitest globalSetup: boot a single ephemeral MySQL for the whole run and expose
 * its connection details via process.env. The src modules build their mysql2
 * pools from these env vars at import time, so writing them here — before the
 * test worker is forked — points every query at the throwaway server instead of
 * a live database.
 */
export async function setup(): Promise<void> {
  // Pin a concrete Oracle MySQL version. Without this, mysql-memory-server may
  // reuse a system-installed `mysqld` (e.g. MariaDB), which rejects MySQL-only
  // init flags like --initialize-insecure and fails to start.
  db = await createDB({ version: '8.0.40', ignoreUnsupportedSystemVersion: true });

  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = String(db.port);
  process.env.DB_USER = db.username;
  process.env.DB_PASSWORD = '';
  process.env.DB_DATABASE = db.dbName;
}

/** Stop the ephemeral server and free its temp datadir. */
export async function teardown(): Promise<void> {
  await db?.stop();
}
