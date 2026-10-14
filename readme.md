# ts-orm

ts-orm is a small, type-safe TypeScript ORM you can read in an afternoon. You declare each table once as a plain struct, and the library infers your row, insert, and update types from that single declaration. The shape in your database and the shape your editor checks never drift apart, because there is only one of them.

It stays out of your way. No decorators, no code generation step, no base-class config to learn, and no runtime dependencies in the core. The same code runs on MySQL, Postgres, SQLite, and SQL Server, so you can build against an in-memory SQLite database and ship on Postgres without rewriting a single query. Every value is bound and every table and column name is validated before it reaches the database, so the usual injection mistakes are not even reachable.

You pick the altitude. Direct functions handle the simple reads and writes, a fluent builder covers operators, grouped logic, joins, and pagination, and a model class gives you dirty tracking, hooks, casts, timestamps, soft deletes, and relations when you want an active-record feel. It does not try to be your whole backend: no auth, no caching, and no schema magic beyond an explicit migration runner. If you want a data layer that is type-safe, portable across engines, and small enough to keep in your head, keep reading.

```bash
npm i @velkymx/ts-orm
```

## A first taste

Find a user by id. The driver comes from the environment, so the model takes only the struct and the database is named nowhere.

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

Hand a driver explicitly only to join a transaction (`Users.find(1, tx)`), or the read silently runs outside it.

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

## Requirements

Node 24 or later. The SQLite driver uses the built-in `node:sqlite`, so it needs no extra package. MySQL rides on the bundled `mysql2`. Postgres (`pg`) and SQL Server (`mssql`) are optional peers, installed only for the engines you use.

## Security

Identifiers pass an allowlist and are quoted per dialect; values are always bound, never interpolated. Payloads validate against the struct before any write. Driver errors map to safe messages, and detail goes to an injectable logger. For search input prefer `whereLike`, which escapes `%` and `_`; raw `LIKE` keeps wildcard power when you ask for it. The library does not handle authentication, request body limits, or output encoding; those stay with your application.
