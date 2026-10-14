# Architecture

This page explains why ts-orm is built the way it is. For how to use each
feature, start with [Getting started](getting-started.md) and the task
guides it links: [Queries](queries.md), [Models](models.md),
[Relations](relations.md), [Transactions](transactions.md), and
[Schema and migrations](schema-and-migrations.md).

## Design decisions

- Struct is the single source of truth. One declaration drives row
  types, validation, SQL generation, and introspection. Nothing is
  redeclared, so types and runtime cannot drift.
- Dual layer. The fluent builder and models cover everyday work with
  full type inference; `driver.query` and `driver.execute` stay open as
  a raw SQL escape hatch with caller-chosen return generics.
- Validation before I/O. Payloads validate against the struct first, so
  bad writes never reach the database.
- Results, not throws, for operations. CRUD returns a `Result` envelope
  discriminated on `success`; only `findOrFail` (and model equivalents)
  throw `NotFoundError`.
- Zero-dependency core. Engine clients (`mysql2`, `pg`, `mssql`) sit
  behind the `Driver` contract; SQLite adds nothing on Node 24+.
- Zero-setup default. `createDefaultDriver()` picks the engine from
  `DB_DIALECT` (mysql, postgres, sqlite, mssql; mysql when unset) and
  opens nothing until first use, so import plus env is the whole setup.
  The sqlite default is an ephemeral `:memory:` database unless `DB_FILE`
  names a file.
- Errors are safe by default. Driver failures map to `OrmError` codes
  with client-safe messages; full detail goes to an injectable logger.
- Erasable syntax only. Sources use no `enum`, `namespace`, parameter
  properties, decorators, or `any`, enforced by `erasableSyntaxOnly`
  plus `verbatimModuleSyntax` in tsconfig and the `no-explicit-any`
  lint rule. `tests/strip-types.test.ts` executes real sources under
  Node type stripping with no build step, so regressions fail loudly.
  Legacy `.js` twins that shadow a TS module are removed on sight:
  they silently win module resolution.
- Introspection reads, never owns. `generateStructFromTable` maps a
  live MySQL table to struct fields over the shared driver (no private
  pool), with `tinyint(1)` alone meaning boolean. The CLI `struct`
  command prints that mapping as JSON; shaping it into `defineStruct`
  stays a caller decision.

## Query execution

A builder call compiles in three stages:

1. Conditions collect into an AST (`where`, `orWhere`, nested closures,
   `whereIn`, `whereBetween`, null checks, escaped `whereLike`).
2. The compiler validates every identifier against the allowlist,
   quotes it for the active dialect, and numbers placeholders in bind
   order (`?`, `$n`, `@pN`).
3. The driver runs the statement: `get` returns rows, `first` caps at
   one, `count` reuses the filters without order or paging, `delete`
   removes matching rows and reports `affectedRows`. `sum`, `avg`,
   `min`, and `max` aggregate one column, returning `null` when no rows
   match; `paginate` composes a count with one bounded page into a
   totals envelope.

`toSQL`, `toCountSQL`, and `toDeleteSQL` expose the compiled statement
plus params without I/O, which doubles as the inspection hatch for
debugging.

Empty `IN` lists compile to constant conditions (`1 = 0` for `IN`,
`1 = 1` for `NOT IN`) so no invalid SQL is ever emitted. `BETWEEN`
binds two values; `IS NULL` binds none.

Join reads accept qualified `ORDER BY` targets (`posts.id`), quoting
each half; bare names keep working and malformed qualifiers throw.

## Metadata

Structs carry everything the layers need: column names and field types
for SQL and hydration, `required` plus `length` plus `enum` for
validation, `default` for insert behavior (`auto_increment` columns are
never written, database defaults are omitted so the engine applies
them). `RowOf`, `InsertOf`, and `UpdateOf` project the metadata into
read, write, and partial-update shapes. Introspection
(`generateStructFromTable`) reads the same shape back out of a live
database for scaffolding, and `structColumns` folds it forward into
schema-builder column definitions.

Reads trust the engine. Writes validate against the struct, but rows
coming back are cast to the row type without a runtime check, so a few
engine behaviors surface as values that do not match their declared
type. Postgres returns `NUMERIC` and `BIGINT` as strings. MySQL
`BIGINT` values past 2^53 lose precision when read as a JavaScript
number. A `NULL` in a column the struct marks `required` still types as
non-null. None of these are caught at read time; handle large integers
as strings or `bigint`, and do not assume a required column is never
null in data the library did not write.

## Schema and migrations

The schema builder compiles DDL per dialect from one column
description: `buildCreateTable` guarded for safe retries (IF NOT EXISTS,
or an OBJECT_ID guard on SQL Server), `buildAddColumn`
and `buildDropColumn`, `buildCreateIndex` and `buildDropIndex`, plus
`buildAddForeignKey` on engines that allow post-creation constraints
(SQLite throws; define references inline instead). Auto-increment
primary keys use each engine's native identity. Migrations are plain
`{ name, up, down }` objects run oldest first by `migrate`, which
records each success in `tsorm_migrations` so reruns apply nothing;
`rollback` reverses the latest batch newest first and throws on
unregistered names instead of guessing. DDL is not transactional on
every engine, so tracking writes follow the migration and a retry
replays exactly the remainder. The CLI exposes `make:migration`,
`migrate`, and `migrate:rollback` over the same runner.

## Driver architecture

`Driver` is the only contract the core speaks: a `dialect`, `query`,
`execute`, `close`, and an optional `beginTransaction` returning a
`TxConnection` (a `Driver` plus `commit`, `rollback`, `release`).

Per-engine differences live in exactly four places, all on `Dialect`:

- Identifier quoting: backticks, double quotes, or brackets.
- Placeholders: `?` everywhere, `$n` on Postgres, `@pN` on MSSQL.
- Paging: `LIMIT`/`OFFSET`, except MSSQL `OFFSET`/`FETCH`, which the
  builders pair with an `ORDER BY` fallback when none is given.
- New-row ids: driver-reported, `RETURNING`, or `OUTPUT`.

Connections are pooled per engine and created lazily: the MySQL pool on
first use with explicit `configure`, Postgres and MSSQL pools inside
their drivers, SQLite as a single embedded handle. Importing the
library loads `.env` once (never overriding already set variables), so
pool settings resolve with no manual dotenv bootstrap. `closePool` and
`driver.close` release everything so processes exit cleanly.

Transactions check out a dedicated connection, run `BEGIN`, then commit
on success or roll back on throw, and always release. `TxHandle` adds
`AsyncDisposable`, so a throw inside an `await using` scope still
releases. `Driver` itself is async disposable too: leaving an
`await using` scope closes pool drivers and releases checked-out
connections, so throws never leak. A `TxConnection` satisfies `Driver`,
so CRUD, builders, and models run inside transactions unchanged.

## Relations

Relations bind two structs with their key columns: `hasOne` and
`hasMany` through a foreign key, `belongsTo` through the owner key,
`belongsToMany` through a pivot struct, and `morphMany` through a type
column plus value. `load` resolves many parents in a constant number of
queries (one, two across a pivot, none for empty input) by collecting
keys into a single `WHERE IN` per table and stitching rows in memory.
`loadOne` covers the single-row kinds. `deleteRelated` removes
dependent rows with the builder delete primitive, which is what keeps
polymorphic children from orphaning. Its mode sets the child contract
explicitly: `force` (the default) removes physically including pivot
detaches, `soft` stamps the child delete column and skips already
stamped rows while pivot links still detach physically, `ignore` touches
nothing. `belongsTo` owns no rows and throws in every mode. Bulk paths
fire no hooks.

## Lifecycle

Hooks run around model writes only: `saving` plus `creating` before an
insert and `created` plus `saved` after, `saving` plus `updating`
before a dirty update and `updated` plus `saved` after, `deleting`
before a delete and `deleted` after, `restoring` before a restore and
`restored` after, `forceDeleting` before a force delete and
`forceDeleted` after. A throw vetoes the write before
any SQL runs. The CRUD functions never dispatch, so bulk and raw paths
have explicit no-event semantics.

Nothing opens its own transaction for hooks. After-hooks deliver inline
on plain drivers and defer to the outer commit inside a caller
transaction through `afterCommit`, drained by `transaction` and
`TxHandle.commit`. Deferred failures log through the error route and
never fail the write, so a committed write is never reported as
rolled back. Delivery is best-effort with no retry or durability; use
an outbox for crash-durable needs.

The after-hooks (`created`, `updated`, `saved`, and the delete and
restore pairs) mean after the write commits, or after the autocommitted
write on a plain driver, never merely after the SQL runs inside an open
transaction. The CRUD functions never dispatch, so `Model.save` carries
lifecycle behavior while lower-level CRUD calls stay side-effect free;
never expect hooks from a CRUD call.

Timestamps are built-in hooks, not inline writes: `creating` fills
`created_at` when the column exists and no value was given, `updating`
always refreshes `updated_at` when it exists. Presence gates each
column, `static timestamps = false` opts out, and no-op saves stay
silent.

Casts translate between storage shapes and app shapes at the model
layer only; raw builder rows stay untouched. `static casts` maps
columns to `boolean`, `integer`, `datetime`, or `json`. `castIn`
serializes before validation and SQL, `castOut` normalizes on hydrate,
and dirty tracking compares normalized values so `1` equals `true`
and `'{"a":1}'` equals `{a:1}`. Null stays null both ways, corrupt
values throw `CastError` naming the column.

Soft deletes are opt-in per model: `static softDeletes = true` plus a
`deleted_at` column, and the flag without the column throws on every
soft path instead of deleting physically by accident. `delete` stamps
the column and fires `deleting`/`deleted`; model reads (`find`,
`findOrFail`, `all`, `query`) hide stamped rows when the flag is set,
while relation loads filter whenever the target struct declares the
column (struct level, no flag involved), and raw CRUD plus
raw SQL never scope. `withTrashed` (model scope, builder method, load
option) shows trashed rows again. `restore` clears the stamp with
`restoring`/`restored`, `forceDelete` removes the row physically with
`forceDeleting`/`forceDeleted`. Repeat behavior is fixed: deleting a
trashed instance and restoring a clean one are silent no-ops, a second
`forceDelete` succeeds with zero rows. Bulk `deleteWhere` on a soft
model stamps matches (skipping trashed) with no hooks, matching the
no-event rule for bulk paths. Soft paths never touch `updated_at` and
compose with `datetime` casts on `deleted_at`. `Model.delete` never
cascades; compose `deleteRelated` explicitly for the child contract.

No savepoint nesting on pooled drivers: each `transaction` call checks out an
independent connection and commits independently. SQLite nests inner calls as
savepoints instead, and serializes top-level transactions and ordinary
operations around its single handle, so concurrent work waits rather than
sharing state. Inside a transaction callback, use only the tx handle.
