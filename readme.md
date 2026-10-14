# ts-orm

A small, type-safe TypeScript ORM. Declare each table once as a struct, then run the same code against MySQL, Postgres, SQLite, or SQL Server. Values are always bound, identifiers are always validated, and errors come back safe.

```bash
npm i @velkymx/ts-orm
```

## A first taste

Import plus environment is the whole setup. `createDefaultDriver()` reads the engine and connection settings from the environment, loading a `.env` file automatically, so there is no `configure` call and no driver to pick by hand.

```bash
# .env
DB_DIALECT=sqlite   # mysql, postgres, sqlite, or mssql; defaults to mysql
```

```ts
import { defineStruct, createDefaultDriver, create, read } from '@velkymx/ts-orm';

const driver = createDefaultDriver();

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

await driver.execute('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)', []);

await create(driver, User, { name: 'Ada' });

const users = await read(driver, User);
console.log(users.data); // [{ id: 1, name: 'Ada' }]

await driver.close();
```

With `DB_DIALECT=sqlite` this runs as written on Node 24 or later against an in-memory database (set `DB_FILE` to use a file instead). Switching engines is a one-line environment change, not a code change.

The struct is the only schema you write. The row type, the insert type, and the update type are inferred from it, so your editor knows `name` is a string and `id` is a number without a second declaration.

## What you get

The struct drives four layers that share one set of types. Direct CRUD functions (`create`, `read`, `update`, `remove`) handle one-call reads and writes. A fluent query builder covers operators, `OR` groups, `IN`, `BETWEEN`, `LIKE`, paging, and aggregates. A model base class adds dirty tracking, lifecycle hooks, attribute casts, automatic timestamps, and soft deletes. Relations load related rows in batched queries. Transactions commit on success and roll back on a throw. A schema builder and migration runner sit behind the `ts-orm` CLI.

Every write validates against the struct before it reaches the database, and every driver failure maps to a safe client message while the full detail goes to a logger you control.

## The CLI

Read a live MySQL table into a struct field map:

```bash
npx ts-orm struct users
```

It connects through the environment (`DB_HOST`, `DB_USER`, `DB_DATABASE`, and optionally `DB_PASSWORD` and `DB_PORT`) and writes the mapped fields to `./users.json`, ready to fold into `defineStruct`. On a bad table name or a failed connection it prints a message and exits non-zero.

Version the schema from code:

```bash
npx ts-orm make:migration add_posts
npx ts-orm migrate
npx ts-orm migrate:rollback
```

[Schema and migrations](docs/schema-and-migrations.md) covers the runner and the schema builder in full.

## Documentation

Read these in order the first time:

1. [Getting started](docs/getting-started.md): install, configure, your first model, your first query.
2. [Queries](docs/queries.md): the query builder, from one condition to grouped logic and pagination.
3. [Models](docs/models.md): instances, dirty tracking, hooks, timestamps, casts, and soft deletes.
4. [Relations](docs/relations.md): hasMany, belongsTo, many-to-many, polymorphic, and eager loading.
5. [Transactions](docs/transactions.md): the callback form, manual handles, and how hooks defer to commit.
6. [Schema and migrations](docs/schema-and-migrations.md): the schema builder, the runner, and the CLI.
7. [Architecture](docs/architecture.md): the design decisions and the driver seam, for contributors.

Runnable versions of every example live in [examples/](examples/). Build once with `npm run build`, then run any file, for example `node examples/basic-crud.mjs`.

## Requirements

Node 24 or later. The SQLite driver uses the built-in `node:sqlite`, so it needs no extra package. MySQL rides on the bundled `mysql2`. Postgres (`pg`) and SQL Server (`mssql`) are optional peers, installed only for the engines you use.

## Security

Identifiers pass an allowlist and are quoted per dialect; values are always bound, never interpolated. Payloads validate against the struct before any write. Driver errors map to safe messages, and detail goes to an injectable logger. For search input prefer `whereLike`, which escapes `%` and `_`; raw `LIKE` keeps wildcard power when you ask for it. The library does not handle authentication, request body limits, or output encoding; those stay with your application.
