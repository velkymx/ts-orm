# ts-orm

A lightweight, type-safe TypeScript ORM. Declare each table once as a
struct, then use the same code against MySQL, Postgres, SQLite, or MSSQL.
Values are always bound, identifiers always validated, errors always safe.

## Quick start

```bash
npm i @velkymx/ts-orm
```

```ts
import { defineStruct, createSqliteDriver, create, read } from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });
const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);
await create(driver, User, { name: 'Ada' });
console.log(await read(driver, User, {}));
await driver.close();
```

## Core features

- Struct-first schemas with inferred row, insert, and update types
- Fluent query builder: operators, `IN`, `BETWEEN`, `LIKE`, `AND`/`OR` groups, paging, `COUNT`
- Model base class with dirty-tracked saves and transactions
- Relations with batched eager loading plus dependent deletes
- Model lifecycle hooks with transaction-aware delivery
- Multi-engine drivers sharing one `Driver` contract
- Transactions with auto commit/rollback plus disposable handles
- Validation-first writes and a sanitized, injectable-logger error route

## CLI

Generate a struct field map from a live MySQL table:

```bash
npx ts-orm struct users
```

It reads the table through the shared connection (set `DB_HOST`, `DB_USER`,
`DB_DATABASE`, and optionally `DB_PASSWORD` and `DB_PORT`) and writes the
mapped fields to `./users.json`. Fold that output into `defineStruct` to
declare the model. On an invalid table name or a connection failure it prints
a message and exits non-zero.

## Docs

- [Getting started](docs/getting-started.md): installation, configuration, first model, first query
- [Architecture](docs/architecture.md): design decisions, query execution, metadata, drivers
- [Security](#security): guarantees plus app responsibilities, below
- [Contributing](CONTRIBUTING.md): setup, testing, pull requests, releases

Runnable examples live in [examples/](examples/); each runs against the
published barrel (`dist/index.js`, rebuild with `npm run build` first).

## Security

- Identifiers pass an allowlist and are quoted per dialect; all values bound
- Payloads validate against structs before writes
- Driver errors map to safe messages; detail goes to the injectable logger
- Search input: prefer `whereLike`, which escapes `%` and `_`; raw `LIKE` keeps wildcard power by intent
- The library does not do auth, body limits, or output encoding; those stay with the app

## Requirements

Node 24 or later (the SQLite driver uses the built-in `node:sqlite`).
MySQL via `mysql2`; Postgres via `pg` and MSSQL via `mssql` as optional peers.
