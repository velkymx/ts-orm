# API reference

This page is the authoritative list of what ts-orm exports and promises to keep stable. It describes the surface as it stands today, nothing more: no history, no migration notes. For how to use each piece, follow the task guides linked from the [documentation index](../llms.txt); for why the library is shaped this way, read [Architecture](architecture.md).

## The stability contract

The public API is exactly the top-level barrel: everything you can reach with

```ts
import { ... } from '@velkymx/ts-orm';
```

and nothing else. Every value and type listed on this page is imported from that entry point. The guides and examples use only this surface, and so should your code.

A deep import that reaches past the barrel into a file under `src/` is not public. Those modules hold internal helpers and private state that carry no stability promise and may change, move, or vanish in any release. If something you need is not re-exported from the barrel, treat its absence as deliberate and open an issue rather than importing it directly.

Within the public surface there are two tiers. The everyday API is what the guides teach and what almost all application code uses. The low-level building blocks are public and supported but rarely needed directly, since the everyday API composes them for you. Both tiers are covered by the stability contract; the split is about which layer to reach for, not about which is safe to depend on. The optimal path is always the smallest layer that solves the task: a CRUD function before the builder, the builder before a model, and the schema builder before raw DDL.

## Versioning and the freeze

The package is on the `2.0.0-dev.x` prerelease line, and the surface is not yet frozen. While on this line:

- Breaking changes to the listed surface are allowed. They land on `develop` and advance the `dev.N` prerelease segment.
- Additions and behavior fixes also advance `dev.N`; a prerelease draws no minor or patch distinction.

The surface freezes at the `2.0.0` release. From that tag on, the contract is standard semantic versioning against this page:

- Removing a listed export, or changing its signature or runtime contract, requires a major bump.
- Adding a new export requires a minor bump.
- Fixing behavior without changing the surface requires a patch bump.

There is no changelog file. The record of what changed in a release is the set of GitHub issues closed for that release, linked from the release notes for its tag. Any pull request that changes the exports in `src/index.ts` updates this page in the same pull request, so the two never drift.

## Everyday API

### Structs

One `defineStruct` call declares a table and infers its row, insert, and update types. Never hand-write those types.

- `defineStruct` builds a bound struct from a table name and a field map.
- Types: `Struct`, `Fields`, `FieldDef`, `FieldType`, `ScalarOf`, `RowOf`, `InsertOf`, `UpdateOf`.

### Drivers and configuration

A driver is the first argument to every CRUD function, builder, and migration. Prefer the environment driver; name a database in application code only when you must.

- `createDefaultDriver`, `getDefaultDriver`, `resetDefaultDriver` resolve the engine from `DB_DIALECT` and open nothing until first use.
- `createMysqlDriver`, `createPostgresDriver`, `createSqliteDriver`, `createMssqlDriver` build a driver for one engine.
- `configure`, `configurePostgres`, `configureMssql` supply explicit connection settings; `getPool` and `closePool` manage the shared MySQL pool; `resolveConfig` resolves settings from overrides plus the environment.
- Types: `Driver`, `TxConnection`, `BindValue`, `ExecuteResult`, `DbConfig`, `SqliteOptions`.

### The result envelope

CRUD and builder calls return a `Result` discriminated on `success`. Check `success`, then read `data` or `errors`.

- `ok`, `fail` build the two variants.
- Types: `Result`, `Ok`, `Err`.

### CRUD

The smallest layer. Each function takes the driver and the struct and returns a `Result`; `findOrFail` throws `NotFoundError` on a miss.

- `create`, `read`, `readOne`, `readWith`, `findOrFail`, `update`, `remove`, `NotFoundError`.
- Types: `ReadOptions`, `JoinSpec`.

### The query builder

`query(driver, struct)` starts a chain that compiles to one parameterized statement. Columns are checked against the struct and values are always bound.

- `query`, `QueryBuilder`.
- Types: `ComparisonOperator`, `BooleanOp`, `GroupFn`, `AggregateFn`, `Page`, `SelectedRow`, `LockMode`.

### Models

`defineModel(struct)` binds the environment driver and one struct into a class you extend. Reach for it when you want dirty tracking, hooks, timestamps, casts, soft deletes, or relations.

- `defineModel`.
- Types: `ModelInstance`, `ModelStatic`, `ScopedReads`.

### Transactions

Group writes so they commit together. Pass the `tx` connection to every call that should be inside the transaction.

- `transaction` (callback form), `beginTransaction` and `TxHandle` (manual handle), `TransactionNotSupportedError`.

### Relations

Declare a relation between two structs, then load it for many parents at once with batched queries, or delete dependents.

- `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, `morphMany` declare relations; `load`, `loadOne` resolve them; `deleteRelated` removes dependents.
- Types: `Relation`, `RelationKind`, `HasOne`, `HasMany`, `BelongsTo`, `BelongsToMany`, `MorphMany`, `Loaded`, `LoadOptions`, `DeleteRelatedMode`.

### Validation

Payloads validate before any SQL. Reads trust the engine, so call `validateRow` yourself at ingestion boundaries.

- `validatePayload`, `validateRow`, `isValidUUID`, `isValidDatetime`, `isValidDate`, `isValidBoolean`.
- Types: `ValidationError`, `ValidateOptions`.

### Attribute casts

Translate between stored and application form at the model layer.

- `castIn`, `castOut`, `valuesEqual`, `CastError`.
- Types: `CastType`, `Casts`.

### Soft deletes

Hide rows behind a stamped column instead of removing them.

- `SOFT_COLUMN`, `hasSoftColumn`, `requireSoftColumn`, `softColumnOf`, `softStamp`, `isTrashed`.

### Lifecycle hooks

Run code around model writes; after-hooks defer to commit inside a transaction.

- `runHooks`, `isTransaction`, `afterCommit`, `drainAfterCommit`, `deliver`, `timestampNow`, `timestampHooks`.
- Types: `HookName`, `HookContext`, `HookFn`, `ModelHooks`.

### Schema builder and migrations

Build DDL from the same structs and run ordered migrations against a tracking table. This is the supported way to create schema; do not hand-write DDL.

- `structColumns`, `indexName`, `buildCreateTable`, `buildAddColumn`, `buildDropColumn`, `buildCreateIndex`, `buildDropIndex`, `buildAddForeignKey`.
- `migrate`, `rollback`, `trackingSql`, `MIGRATIONS_TABLE`.
- Types: `ColumnDef`, `ReferenceDef`, `Migration`, `MigrateResult`, `RollbackResult`, `TrackingSql`.

## Low-level building blocks

Public and supported, but the everyday API composes these for you. Reach here only for raw SQL generation, custom tooling, or engine-specific error handling.

### Dialects

- `mysql`, `postgres`, `sqlite`, `mssql` are the dialect objects every compiler takes first.
- Types: `Dialect`, `DialectName`, `InsertIdStrategy`.

### Identifiers

- `isIdentifier`, `isQualifiedIdentifier`, `safeIdentifier`, `safeQualified`, `escapeLike` validate and quote names and escape `LIKE` input.
- Type: `SafeIdentifier`.

### Statement compilers

Compile a single statement without running it. The builder and CRUD layer call these; use them directly only to generate SQL yourself.

- `buildInsert`, `buildSelect`, `buildSelectWith`, `buildUpdate`, `buildSoftUpdate`, `buildSoftRestore`, `buildDelete`, `primaryKey`.
- Type: `BuiltStatement`.

### Errors and logging

- `OrmError` is the mapped error type; `setLogger`, `resetLogger`, `logError` control the injectable logger; `sanitizeError` maps a raw driver failure to a client-safe message.
- `mapMysqlError`, `mapPostgresError`, `mapSqliteError`, `mapMssqlError` map one engine's native errors.
- Types: `OrmErrorCode`, `Logger`.

### Introspection

- `mapColumnToField`, `generateStructFromTable` read a live table back into struct fields.
- Types: `ShowColumnRow`, `IntrospectedField`.

### CLI

- `runCli` is the entry point behind the `ts-orm` binary (`make:migration`, `migrate`, `migrate:rollback`, `model`, `struct`).
- Type: `CliDeps`.

## Not public

Anything not on this page is internal, including every helper that lives in a `src/` module but is not re-exported from the barrel. Internal code carries no stability promise. Depend on the surface above; if you find yourself wanting an internal, open an issue so it can be considered for promotion.
