# VibeORM

[![Node.js CI](https://github.com/velkymx/ts-orm/actions/workflows/node.js.yml/badge.svg)](https://github.com/velkymx/ts-orm/actions/workflows/node.js.yml)
[![npm version](https://img.shields.io/npm/v/@velkymx/vibeorm.svg)](https://www.npmjs.com/package/@velkymx/vibeorm)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.19-339933.svg)](https://nodejs.org/)
[![MySQL | MariaDB](https://img.shields.io/badge/MySQL%20%7C%20MariaDB-tested-f29111.svg)](#database-support)
[![coverage](https://img.shields.io/badge/coverage-~94%25-brightgreen.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)

A lightweight ORM for Node.js and MySQL2 with an Eloquent-like Model API and a chainable query builder. Schemas are plain JSON arrays, or you can auto-generate them from your existing database with the CLI.

---

## Features

- Eloquent-like Model API — chainable, readable, no decorators
- Function-based CRUD API — small, predictable, callable from anywhere
- Advanced query builder — `where`/`orWhere`/`whereIn`/`whereLike`/`whereAny`/`whereAll`/`whereNone`, `innerJoin`/`leftJoin`/`rightJoin`/`outerJoin`, `count`/`sum`/`avg`/`max`/`min`, `pluck`, `select`
- Typed rows — `model<User>('users', struct)` flows `OrmResponse<User>` / `OrmResponse<User[]>`
- Transactions — `withTransaction(fn)` (atomic, auto-routed via AsyncLocalStorage)
- Soft deletes — `{ softDelete: true }`: auto-scoped reads, `withTrashed`/`onlyTrashed`/`restore`
- Casts — `boolean` (TINYINT ↔ bool) and `json` (text ↔ object) on read/write
- Auto-generate structs from MySQL tables — `npx vibeorm struct <table>`
- Identifier allowlist + operator allowlist + error sanitization
- Pluggable logger — ship your own pino/winston adapter; query/slow-query logging
- Health + lifecycle — `ping()` readiness probe, `close()` graceful shutdown
- MySQL, MariaDB, RDS/Aurora-MySQL (optional TLS) — config only
- TypeScript build, ships `dist/` with `.d.ts` + declaration maps
- Single shared mysql2 connection pool

---

## Installation

```bash
npm install @velkymx/vibeorm
```

## Configuration

Create a `.env` in your project root. The package calls `dotenv.config()` once on import.

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=myapp

# Optional TLS (managed engines like RDS/Aurora usually require it)
# DB_SSL=Amazon RDS        # mysql2's bundled RDS CA bundle (verified)
# DB_SSL=no-verify         # TLS without cert verification (self-signed)
# DB_SSL=true              # verified TLS

# Optional pool tuning / observability
# DB_CONNECTION_LIMIT=10   # max pooled connections (default mysql2 = 10)
# DB_CONNECT_TIMEOUT=10000 # connect timeout in ms
# DB_SLOW_QUERY_MS=200     # warn-log queries slower than this (0/unset = off)
```

---

## Quick Start

### Function-based API

```js
import { create, read, readOne, findOrFail, update, remove, validatePayload } from '@velkymx/vibeorm';

const userStruct = [
  { name: 'id',         type: 'uuid',     required: true,  length: 36,  default: '' },
  { name: 'name',       type: 'string',   required: true,  length: 128, default: '' },
  { name: 'email',      type: 'string',   required: true,  length: 256, default: '' },
  { name: 'status',     type: 'enum',     required: false, enum: ['active', 'inactive'], default: 'active' },
  { name: 'created_at', type: 'datetime', required: true,  default: 'current_timestamp' }
];

// Create
const created = await create('users', userStruct, {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com'
});
// { success: true, message: 'Record created', data: { id: <insertId> } }

// Read (with optional order/limit/offset)
const all = await read('users');
const one = await read('users', { status: 'active' });
const paged = await read('users', {}, { orderBy: 'created_at', direction: 'DESC', limit: 20, offset: 0 });

// readOne returns a single row or a 'Record not found' envelope
const user = await readOne('users', { email: 'alice@example.com' });

// findOrFail — same envelope (does not throw on miss)
const found = await findOrFail('users', 'id', '123e4567-e89b-12d3-a456-426614174000');

// Read with joins
const withPosts = await readWith(
  'users',
  { status: 'active' },
  [{ type: 'inner', table: 'posts', on: ['users.id', 'posts.user_id'] }],
  { orderBy: 'users.created_at', direction: 'DESC' }
);

// Update (payload must include the primary key; partial — only provided columns are written)
const updated = await update('users', userStruct, {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice Updated'
});

// Remove
const deleted = await remove('users', 'id', '123e4567-e89b-12d3-a456-426614174000');
```

Every operation returns a consistent envelope:

```js
{ success: true,  message: '...', data: <T> }
// or
{ success: false, message: 'Validation failed' | 'Database operation failed' | 'Record not found' | 'No fields to update', data: <string[] | string> }
```

### Model API

```js
import { model } from '@velkymx/vibeorm';
import userStruct from './users.json' with { type: 'json' };

const User = model('users', userStruct);

const alice    = await User.find('123e4567-e89b-12d3-a456-426614174000');
const active   = await User.where('status', 'active').get();
const adults   = await User.where('age', '>', 18).get();
const searched = await User.whereLike('email', '%@gmail.com').get();
const newest   = await User.orderBy('created_at', 'DESC').first();
const count    = await User.where('status', 'active').count();
const emails   = await User.where('status', 'active').pluck('email');

await User.create({ name: 'Alice', email: 'alice@example.com' });
await User.update({ id: '123e4567-e89b-12d3-a456-426614174000', name: 'Alice Updated' });
await User.delete('123e4567-e89b-12d3-a456-426614174000');
```

---

## CLI: Generate Structs From a Database

Inspect an existing table and emit a JSON struct you can import as-is:

```bash
npx vibeorm struct users
# -> Struct written to ./users.json
```

The CLI reads `.env` for the connection, writes `./<table>.json`, then closes the shared pool so the process exits.

Generate one or many:

```bash
npx vibeorm struct users
npx vibeorm struct posts
for t in users posts comments; do npx vibeorm struct $t; done
```

The introspector maps MySQL types to ORM types (`int/bigint` → `number`, `tinyint` → `boolean`, `varchar/char/text` → `string`, `date` → `date`, `datetime/timestamp` → `datetime`, `enum` → `enum`, `json` → `json`, `decimal/numeric/float/double/smallint/mediumint` → `number`), detects `CHAR(36)`/`VARCHAR(36)` UUIDs by name, flags `auto_increment` columns, and handles `CURRENT_TIMESTAMP` defaults. Failures are sanitized (no schema/credential leakage) and re-thrown with the full error logged server-side.

---

## Query Builder

```js
import { model } from '@velkymx/vibeorm';
const User = model('users', userStruct);

// or use the builder directly
import { QueryBuilder } from '@velkymx/vibeorm';
const qb = new QueryBuilder('users', userStruct);
```

### WHERE

```js
// Equality / comparison
User.where('status', 'active').get();
User.where('age', '>', 18).get();
User.where('age', '>=', 18).get();

// Negation
User.whereNot('status', 'banned').get();
User.orWhereNot('role', 'guest').get();

// Lists
User.whereIn('status', ['active', 'pending']).get();
User.whereNotIn('role', ['guest', 'banned']).get();
User.orWhereIn('type', ['vip']).get();

// NULL
User.whereNull('last_login').get();
User.whereNotNull('age').get();
User.orWhereNull('phone').get();
User.orWhereNotNull('address').get();

// Pattern matching
User.whereLike('email', '%@gmail.com').get();
User.whereNotLike('name', 'Admin%').get();
User.orWhereLike('name', 'John%').get();
User.orWhereNotLike('email', '%spam%').get();

// Multi-column
User.whereAny(['email', 'phone', 'username'], 'john').get();   // (a = ? OR b = ? OR c = ?)
User.whereAll(['status', 'verification_status'], 'active').get();
User.whereNone(['status', 'account_status'], 'banned').get();  // (a != ? AND b != ?)

// Combine with object shorthand
User.where({ status: 'active', role: 'admin' }).get();
```

An empty `IN` list matches nothing (`0=1`); an empty `NOT IN` matches everything (`1=1`). Both are safe — never an `IN ()` parse error.

### JOINs

```js
User.innerJoin('posts', 'users.id', 'posts.user_id').get();
User.leftJoin('profiles', 'users.id', 'profiles.user_id').whereNull('profiles.id').get();
User.rightJoin('orders', 'users.id', 'orders.user_id').get(); // alias: outerJoin
User.innerJoin('posts', 'users.id', '!=', 'posts.author_id').get(); // custom operator

// Chain multiple joins
User
  .innerJoin('posts',   'users.id',    'posts.user_id')
  .leftJoin('comments', 'posts.id',    'comments.post_id')
  .where('users.status', 'active')
  .get();
```

Columns may be qualified (`users.id`) or simple. Operators are validated against an allowlist (`= != <> > < >= <= LIKE NOT LIKE`); anything else throws immediately.

### Ordering, Pagination, Aggregates, Pluck

```js
User.orderBy('created_at', 'DESC').limit(20).offset(0).get();
User.count();                                   // -> { success, message, data: <number> }
User.where('status', 'active').count();
User.sum('balance');                            // DECIMAL coerced to Number
User.avg('age');
User.max('age');
User.min('age');
User.where('status', 'active').pluck('email');  // -> { success, message, data: [<email>, ...] }
```

`OFFSET` without `LIMIT` is auto-padded with MySQL's max-row sentinel so the SQL stays valid.

### Termination

`get()` returns all rows, `first()` returns the first row (or `Record not found`). Aggregate methods return a scalar in `data`. `pluck(field)` returns an array of just that column's values.

---

## Struct Field Types

| Type             | Description                          | Notes                                                                 |
|------------------|--------------------------------------|-----------------------------------------------------------------------|
| `uuid`           | Universally unique identifier        | Must match UUID v4 format                                             |
| `string`         | Text                                 | `length` caps max characters                                          |
| `number`         | Integer or float                     | Rejects blank strings, `NaN`, `Infinity`; requires a finite value     |
| `datetime`       | Date and time                        | Must match `YYYY-MM-DD HH:MM:SS`; `'current_timestamp'` accepted as default literal |
| `date`           | Date only                            | Must match `YYYY-MM-DD`                                               |
| `boolean`        | Boolean flag                         | `true` / `false` / `0` / `1` only; stored as TINYINT                  |
| `enum`           | Predefined set                       | Requires `enum: [...]`; `null`/`undefined` allowed when not required  |
| `json`           | JSON column                          | Cast on read (text → object/array) and write (object → JSON text)    |
| `boolean`        | (see above) cast on read 0/1 → `true`/`false`, write `true`/`false` → 0/1 |                                |
| `auto_increment` | Special case (a `number` with `default: 'auto_increment'`) | Caller must not supply on insert                       |

```ts
interface Field {
  name: string;
  type: 'number' | 'string' | 'uuid' | 'datetime' | 'date' | 'boolean' | 'enum' | 'json';
  required?: boolean;
  length?: number | null;
  default?: unknown;
  enum?: string[];
}
```

A `Field` is the only thing every API path needs. Generate one with the CLI, hand-write one, or share one across modules — they are interchangeable.

---

## Pluggable Logging

VibeORM emits structured events through a `Logger` interface and ships a console default (min level `warn`, `[vibeorm]` prefix, errors to `console.error`). Inject your own pino/winston adapter to route events into your stack — the ORM never writes to the filesystem.

```js
import { setLogger, createConsoleLogger } from '@velkymx/vibeorm';

// Use the default console logger, tuned to debug (shows SQL, etc.)
setLogger(createConsoleLogger('debug'));

// Or plug in your own
setLogger({
  debug: (msg, meta) => pinoLogger.debug(meta, msg),
  info:  (msg, meta) => pinoLogger.info(meta, msg),
  warn:  (msg, meta) => pinoLogger.warn(meta, msg),
  error: (msg, meta) => pinoLogger.error(meta, msg),
});
```

Errors are sanitized before reaching the logger: only error metadata and context (operation, table) are emitted. Bound values are never logged, so PII stays out of your log pipeline.

---

## Typed Models

Pass a row type to `model` and it flows to every read:

```ts
interface User { id: number; name: string; email: string; }

const User = model<User>('users', userStruct);

const r = await User.find(1);
if (r.success) r.data.name;          // typed as User

const list = await User.all();
if (list.success) list.data[0]?.email; // typed as User[]
```

Defaults to `Record<string, unknown>`, so untyped callers are unaffected. Generics are compile-time only — no runtime cost.

---

## Transactions

`withTransaction(fn)` runs every operation inside `fn` on one connection — commit on resolve, rollback on throw (re-thrown). Routing is automatic (via `AsyncLocalStorage`); ops keep their normal signatures. Nested calls join the outer transaction.

```js
import { withTransaction, model } from '@velkymx/vibeorm';
const Account = model('accounts', accountStruct);

await withTransaction(async () => {
  await Account.update({ id: 1, balance: 900 });
  await Account.update({ id: 2, balance: 1100 });
  // throw here -> both updates roll back
});
```

---

## Soft Deletes

Enable per model. `delete()` then sets `deleted_at` instead of removing the row, and reads auto-scope out deleted rows.

```js
const User = model('users', userStruct, { softDelete: true /* , deletedAt: 'deleted_at' */ });

await User.delete(1);                     // UPDATE ... SET deleted_at = NOW()
await User.all();                         // excludes soft-deleted
await User.withTrashed().get();           // includes them
await User.onlyTrashed().get();           // only deleted
await User.restore(1);                    // clears deleted_at
```

Without `softDelete`, `delete()` is a hard `DELETE`.

---

## Casts

`boolean` and `json` fields are converted between DB and JS automatically — read (DB → JS) in `get`/`find`/`all`/`first` and write (JS → DB) in `create`/`update`:

```js
await User.create({ active: true, meta: { plan: 'pro' } });
// stored as TINYINT 1 and JSON text

const u = (await User.find(1)).data;
u.active; // true (boolean, not 0/1)
u.meta;   // { plan: 'pro' } (object, not a string)
```

`null`/`undefined` pass through; invalid JSON is left as the raw string.

---

## Health & Shutdown

```js
import { ping, close } from '@velkymx/vibeorm';

await ping();   // true if the DB is reachable, false otherwise (readiness/liveness)

process.on('SIGTERM', async () => {
  await close(); // end the shared pool so the process can exit
  process.exit(0);
});
```

---

## Database Support

VibeORM speaks the MySQL wire protocol, so **MySQL**, **MariaDB**, and **RDS / Aurora-MySQL** all work via connection config alone (`DB_*` env, optional `DB_SSL`). CI runs the full suite against both MySQL 8 and MariaDB 11. PostgreSQL and SQLite are not supported.

> **MariaDB note:** MariaDB implements `JSON` as an alias for `LONGTEXT`, so `SHOW COLUMNS` reports `longtext` — introspect maps it to `string`, and json casts won't auto-apply. To get json casting on MariaDB, set `type: 'json'` manually in the struct for those columns.

---

## Testing

Tests run against a real, throwaway MySQL (an ephemeral `mysqld` locally via `mysql-memory-server`, or a service container in CI) — no live database needed.

```bash
npm test            # run the suite
npm run test:coverage
npm run typecheck
npm run build
```

---

## Security

- Identifier allowlist: table and column names must match `[a-zA-Z0-9_]`. Anything containing spaces, quotes, semicolons, or other punctuation is rejected.
- Operator allowlist: comparison operators are validated against `= != <> > < >= <= LIKE NOT LIKE`. A caller-supplied operator can never be interpolated raw into SQL.
- Empty `IN`/`NOT IN` lists never produce `IN ()` (a MySQL parse error) — they map to `0=1` and `1=1` respectively.
- Sanitized error messages: duplicate-key errors become `Record already exists`, foreign-key violations get safe descriptive text, and the full error is logged server-side through the active logger.
- Server-side defaults (`auto_increment`, `CURRENT_TIMESTAMP`) are passed through as SQL defaults, not bound as literal strings.
- Bound parameters everywhere values flow — never string concatenation.

---

## Migrating from v1.5 to v1.6

v1.6.0 is additive. Nothing in 1.5.0 was removed or behaviorally changed. The upgrade is two new opt-in surfaces plus a small set of new exports.

### 1. Adopt the Model API for new code (optional)

`model()` and `QueryBuilder` are now exported alongside the function-based API. They share the same envelope, the same security, and the same struct. Pick one per table — they do not need to be consistent across a project.

```js
// Before (still works)
import { create, read, update } from '@velkymx/vibeorm';

// After — same envelope, chainable
import { model } from '@velkymx/vibeorm';
const User = model('users', userStruct);
```

`User.find`, `User.create`, `User.update`, `User.delete` delegate to the function-based API, so validation and identifier checks are identical.

### 2. Switch joins from manual SQL to `readWith` (optional)

```js
// Before — manual SQL string with hand-escaped identifiers
const sql = `SELECT u.*, p.id AS post_id
             FROM \`users\` u
             LEFT JOIN \`posts\` p ON p.user_id = u.id
             WHERE u.status = ?`;

// After — typed join spec
import { readWith } from '@velkymx/vibeorm';

const rows = await readWith(
  'users',
  { status: 'active' },
  [{ type: 'left', table: 'posts', on: ['users.id', 'posts.user_id'] }],
  { orderBy: 'users.created_at', direction: 'DESC' }
);
```

### 3. Use `readOne` / `findOrFail` instead of slicing `read()` results

`read()` still returns the full array. For a single row:

```js
import { readOne, findOrFail } from '@velkymx/vibeorm';

const user = await readOne('users', { email: 'alice@example.com' });
// { success: false, message: 'Record not found', data: null } on miss

const u = await findOrFail('users', 'id', '123e4567-e89b-12d3-a456-426614174000');
```

`findOrFail` returns the same envelope as every other operation — it does not throw on a miss. If any caller in your codebase was relying on a thrown error, switch them to checking `result.success`.

### 4. New exports worth knowing

| Export                              | Notes                                                                 |
|-------------------------------------|-----------------------------------------------------------------------|
| `model(table, struct, opts?)`       | Returns a Model with `find` / `findOrFail` / `create` / `update` / `delete` / `where` / etc. |
| `QueryBuilder`                      | Class form of the chainable builder; identical to the one `model().where()` returns |
| `setLogger` / `getLogger` / `createConsoleLogger` | Pluggable logging — see the section above               |
| `withTransaction`                   | Run operations atomically (commit/rollback)                          |
| `ping` / `close`                    | Readiness probe / graceful pool shutdown                             |
| `Field`, `FieldType`, `ValidateOptions`, `OrmResponse`, `Logger`, `LogLevel` | Shared TypeScript types                  |
| `validatePayload`                   | Reusable validator — useful in Express middleware / CLI tooling       |

### 5. Logger prefix changed

Server-side errors logged through the ORM are now prefixed `[vibeorm]` (previously `[ts-orm]`). If you grep logs for the old prefix, update the pattern.

### 6. No changes to identifiers, validation, or error shape

The v1.5 security contract still holds: identifier allowlist, operator allowlist, sanitized error messages, partial-update semantics. Nothing in your 1.5 structs, payloads, or error-handling code needs to change.

The full changelog lives in [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT
