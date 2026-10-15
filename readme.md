# ts-orm

A type-safe TypeScript ORM you can read start to finish. One struct declaration produces your row types, validation, SQL, and DDL, so your table's columns and the types your editor enforces come from one place. No code generation, no decorators, no metadata reflection. The core has no dependencies, and `mysql2` is the only runtime dependency, used by the MySQL engine.

The same code runs on MySQL, Postgres, SQLite, and SQL Server. Build against an in-memory SQLite database and ship on Postgres without changing a query.

```bash
npm i @velkymx/ts-orm
```

## Honest results

A bad payload fails validation before any SQL runs, and the error names the column. A driver error comes back as a safe message, with the full detail sent to a logger you supply instead of the response. A missing row is `null`. The type of `select('name')` is `{ name: string }`, so reading a column you did not select is a compile error. The test suite covers each of these.

## Explicit, not ambient

The driver is an argument you pass, not global state. A transaction is a handle you pass to every call inside it, so a statement runs in the transaction only when you put it there. Soft deletes stay on the row you delete and do not reach related rows. Struct-first models and environment drivers are shortcuts you opt into on top of this, and the explicit form stays available underneath.

## A first query

The driver comes from the environment, so the model takes only the struct.

```ts
import { defineStruct, defineModel } from '@velkymx/ts-orm';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

const Users = defineModel(User);

const user = await Users.find(1); // throws on driver failure, null on miss
if (user === null) {
  console.log('No such user');
} else {
  console.log(user.toRow().name); // string, inferred from the struct
}
```

Pass a driver as the last argument to run inside a transaction (`Users.find(1, tx)`); otherwise the call uses the environment driver.

## Three levels

Use direct functions for plain reads and writes. Use the query builder for operators, grouped conditions, joins, and pagination. Use a model class for dirty tracking, hooks, casts, timestamps, soft deletes, and relations. Each level is the one below it with more on top, and you choose how far up to go per call.

## Documentation

Read these in order the first time:

1. [Getting started](docs/getting-started.md): install, configure, your first model, your first query.
2. [Queries](docs/queries.md): the query builder, from one condition to grouped logic and pagination.
3. [Models](docs/models.md): instances, dirty tracking, hooks, timestamps, casts, and soft deletes.
4. [Relations](docs/relations.md): hasMany, belongsTo, many-to-many, polymorphic, and eager loading.
5. [Transactions](docs/transactions.md): the callback form, manual handles, and how hooks defer to commit.
6. [Schema and migrations](docs/schema-and-migrations.md): the schema builder, the runner, and the CLI.
7. [Architecture](docs/architecture.md): the design decisions and the driver seam, for contributors.

The [API reference](docs/api-reference.md) lists every public export and the stability contract.

Runnable versions of every example live in [examples/](examples/). Build once with `npm run build`, then run any file, for example `node examples/basic-crud.mjs`.

## The CLI

Read a live MySQL table into a struct field map:

```bash
npx ts-orm struct users
```

It connects through the environment (`DB_HOST`, `DB_USER`, `DB_DATABASE`, and optionally `DB_PASSWORD` and `DB_PORT`) and writes the mapped fields to `./users.json`, ready to fold into `defineStruct`. On a bad table name or a failed connection it prints a message and exits non-zero.

Scaffold a model:

```bash
npx ts-orm model users
```

It writes `./users.struct.ts`, regenerated on every run, plus `./Users.ts`, a model subclass you own. Rerunning refreshes the struct and leaves your model file alone unless you pass `--force`.

Version the schema from code:

```bash
npx ts-orm make:migration add_posts
npx ts-orm migrate
npx ts-orm migrate:rollback
```

[Schema and migrations](docs/schema-and-migrations.md) covers the runner and the schema builder in full.

## Requirements

Node 24 or later. The SQLite driver uses the built-in `node:sqlite` and needs no extra package. MySQL uses the bundled `mysql2`. Postgres (`pg`) and SQL Server (`mssql`) are optional peers, installed for the engines you use.

## Performance

A mixed workload runs about 12,000 requests per second on Postgres with single-digit-millisecond p99 latency.

## Security

Identifiers pass an allowlist and are quoted per dialect; values are always bound, never interpolated. Payloads validate against the struct before any write. Driver errors map to safe messages, and the detail goes to a logger you supply. For search input, `whereLike` escapes `%` and `_`, while raw `LIKE` keeps wildcard control when you ask for it.
