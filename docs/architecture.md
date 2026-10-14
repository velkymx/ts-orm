# Architecture

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
- Errors are safe by default. Driver failures map to `OrmError` codes
  with client-safe messages; full detail goes to an injectable logger.

## Query execution

A builder call compiles in three stages:

1. Conditions collect into an AST (`where`, `orWhere`, nested closures,
   `whereIn`, `whereBetween`, null checks, escaped `whereLike`).
2. The compiler validates every identifier against the allowlist,
   quotes it for the active dialect, and numbers placeholders in bind
   order (`?`, `$n`, `@pN`).
3. The driver runs the statement: `get` returns rows, `first` caps at
   one, `count` reuses the filters without order or paging.

`toSQL` and `toCountSQL` expose the compiled statement plus params
without I/O, which doubles as the inspection hatch for debugging.

Empty `IN` lists compile to constant conditions (`1 = 0` for `IN`,
`1 = 1` for `NOT IN`) so no invalid SQL is ever emitted. `BETWEEN`
binds two values; `IS NULL` binds none.

## Metadata

Structs carry everything the layers need: column names and field types
for SQL and hydration, `required` plus `length` plus `enum` for
validation, `default` for insert behavior (`auto_increment` columns are
never written, database defaults are omitted so the engine applies
them). `RowOf`, `InsertOf`, and `UpdateOf` project the metadata into
read, write, and partial-update shapes. Introspection
(`generateStructFromTable`) reads the same shape back out of a live
database for scaffolding.

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
their drivers, SQLite as a single embedded handle. `closePool` and
`driver.close` release everything so processes exit cleanly.

Transactions check out a dedicated connection, run `BEGIN`, then commit
on success or roll back on throw, and always release. `TxHandle` adds
`AsyncDisposable`, so a throw inside an `await using` scope still
releases. A `TxConnection` satisfies `Driver`, so CRUD, builders, and
models run inside transactions unchanged.
