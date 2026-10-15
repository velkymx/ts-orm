# ts-orm

A type-safe TypeScript ORM small enough to hold in your head. One struct declaration drives your row types, validation, SQL, and DDL. No codegen, no decorators, no metadata reflection: zero dependencies in the core, and the only runtime dependency is `mysql2` for the MySQL engine. When something breaks at 2am you read a thirty-line function, not a framework's internals. This codebase has been read line by line, and that legibility is the point. Almost no ORM can say it.

The same code runs on MySQL, Postgres, SQLite, and SQL Server, so you build against an in-memory SQLite database and ship on Postgres without rewriting a single query.

```bash
npm i @velkymx/ts-orm
```

## It refuses to lie to you

- Validation failures name the column. A bad payload fails before any SQL reaches the database, with a message that points at the field.
- Driver errors come back mapped to a safe message. The full detail goes to your injectable logger, never raw schema in the response.
- A missing row is `null`. Not an exception, and not an empty result pretending to be data.
- `select('name')` has the type `{ name: string }`, not the whole row with the other columns lying about being present.

Every one of these is pinned by the test suite.

## Explicit over magic

The driver is a parameter, not ambient state. A transaction is a handle you pass to each call, so a read is never accidentally inside or outside it. Soft deletes never cascade unless you ask them to. The few places the library conveniences you, struct-first models that bind the environment driver, are documented overrides layered on top of the explicit core, not replacements for it.

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

## You pick the altitude

Direct functions handle the simple reads and writes. A fluent builder covers operators, grouped logic, joins, and pagination. A model class gives you dirty tracking, hooks, casts, timestamps, soft deletes, and relations when you want an active-record feel. It does not try to be your whole backend: no auth, no caching, no schema magic beyond an explicit migration runner.

## Honest caveats

Read these before you commit to it:

- The API is pre-release and still moving. Freezing it is the one tracked task left before 2.0.
- Exact decimal and big-integer support only just landed.
- Postgres and SQL Server pass the suite, but verify exotic column types against your own live database.
- One maintainer. You should be comfortable reading source. If that last line bothers you, this is not your ORM yet.

## Documentation

Read these in order the first time:

1. [Getting started](docs/getting-started.md): install, configure, your first model, your first query.
2. [Queries](docs/queries.md): the query builder, from one condition to grouped logic and pagination.
3. [Models](docs/models.md): instances, dirty tracking, hooks, timestamps, casts, and soft deletes.
4. [Relations](docs/relations.md): hasMany, belongsTo, many-to-many, polymorphic, and eager loading.
5. [Transactions](docs/transactions.md): the callback form, manual handles, and how hooks defer to commit.
6. [Schema and migrations](docs/schema-and-migrations.md): the schema builder, the runner, and the CLI.
7. [Architecture](docs/architecture.md): the design decisions and the driver seam, for contributors.

The [API reference](docs/api-reference.md) lists every public export and the stability contract when you need to look one up.

Runnable versions of every example live in [examples/](examples/). Build once with `npm run build`, then run any file, for example `node examples/basic-crud.mjs`.

## The CLI

Read a live MySQL table into a struct field map:

```bash
npx ts-orm struct users
```

It connects through the environment (`DB_HOST`, `DB_USER`, `DB_DATABASE`, and optionally `DB_PASSWORD` and `DB_PORT`) and writes the mapped fields to `./users.json`, ready to fold into `defineStruct`. On a bad table name or a failed connection it prints a message and exits non-zero.

Skip the hand-writing with a model scaffold:

```bash
npx ts-orm model users
```

It writes `./users.struct.ts` (regenerated on every run) plus `./Users.ts`, a driver-free model subclass you own. Rerunning refreshes the struct and leaves your model file untouched unless you pass `--force`.

Version the schema from code:

```bash
npx ts-orm make:migration add_posts
npx ts-orm migrate
npx ts-orm migrate:rollback
```

[Schema and migrations](docs/schema-and-migrations.md) covers the runner and the schema builder in full.

## Requirements

Node 24 or later. The SQLite driver uses the built-in `node:sqlite`, so it needs no extra package. MySQL rides on the bundled `mysql2`. Postgres (`pg`) and SQL Server (`mssql`) are optional peers, installed only for the engines you use.

## Performance

Not the bottleneck. A mixed workload benchmarks around 12k requests per second on Postgres with single-digit-millisecond p99s. That is all the number claims: fast enough to get out of the way. The reason to reach for ts-orm is the opposite of a benchmark. Your data layer should be boring, legible, and exactly as wide as your schema.

## Security

Identifiers pass an allowlist and are quoted per dialect; values are always bound, never interpolated. Payloads validate against the struct before any write. Driver errors map to safe messages, and detail goes to an injectable logger. For search input prefer `whereLike`, which escapes `%` and `_`; raw `LIKE` keeps wildcard power when you ask for it. The library does not handle authentication, request body limits, or output encoding; those stay with your application.
