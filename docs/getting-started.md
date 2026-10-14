# Getting started

This page takes you from an empty project to a working model and your first query. Each step runs on its own, and the examples build on each other.

## Install

```bash
npm i @velkymx/ts-orm
```

MySQL support rides on the bundled `mysql2`, and SQLite uses the built-in `node:sqlite`, so neither needs anything extra. Install a peer driver only for the other engines you use:

```bash
npm i pg      # Postgres
npm i mssql   # SQL Server or Azure SQL
```

The library targets Node 24 or later.

## Connect to a database

A driver is the object every other function takes as its first argument. Start with SQLite, because it needs no server and no configuration:

```ts
import { createSqliteDriver } from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });
```

Use `':memory:'` for tests and scratch work, or a path like `'./app.db'` for a real file. For the other engines you supply connection settings, either explicitly or through the environment. Explicit settings win:

```ts
import { configure, createMysqlDriver } from '@velkymx/ts-orm';

configure({
  host: '127.0.0.1',
  user: 'dbuser',
  password: 'password',
  database: 'app',
  port: 3306,
});

const driver = createMysqlDriver();
```

The environment keys are `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, and `DB_PORT` (default 3306). Importing the library loads a `.env` file once, without overriding anything already set, so a local `.env` is enough to start. Postgres and SQL Server take the same settings through `configurePostgres` and `configureMssql`.

If you would rather let the environment pick the engine too, `createDefaultDriver()` reads `DB_DIALECT` (one of `mysql`, `postgres`, `sqlite`, `mssql`, defaulting to `mysql`) and returns the matching driver without opening a connection yet.

When a script finishes, release the connection so the process can exit:

```ts
await driver.close();
```

## Declare a struct

A struct is a single declaration that names a table and its columns. You write it once, and ts-orm infers the row, insert, and update types from it. There is no second type to keep in sync.

```ts
import { defineStruct } from '@velkymx/ts-orm';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});
```

Each field has a `type`, and the options after it act as inline documentation that also drives behavior. The field types are `number`, `string`, `uuid`, `date`, `datetime`, `boolean`, and `enum`. Mark a column `required`, cap a string with `length`, hand insert values to the database with `default`, and list allowed values for an `enum` column.

ts-orm does not create the table for you from a struct unless you run a migration. For this tutorial, create it directly:

```ts
await driver.execute(
  'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "age" INTEGER)',
  [],
);
```

## Read and write with CRUD functions

The direct CRUD functions are the simplest way to work with a struct. Each takes the driver and the struct, and each returns a `Result` rather than throwing on a bad input:

```ts
import { create, read, readOne, update, remove } from '@velkymx/ts-orm';

const created = await create(driver, User, { name: 'Ada', age: 36 });
console.log(created.data.id); // 1

const everyone = await read(driver, User);
const ada = await readOne(driver, User, { name: 'Ada' });

await update(driver, User, { id: 1, age: 37 });
await remove(driver, User, 'id', 1);
```

A `Result` is an object with a `success` flag. On success it carries `data`; on failure it carries `errors`. Check `success` before reading `data`:

```ts
const result = await create(driver, User, { age: 3 }); // name is required
if (!result.success) {
  console.log(result.errors); // ['name is required']
}
```

Validation runs before any SQL, so a payload that violates the struct never reaches the database. That is why `create` above returns a failure instead of a driver error.

## Query with the builder

For anything past a single equality match, reach for the query builder. It compiles a chain of conditions into parameterized SQL:

```ts
import { query } from '@velkymx/ts-orm';

const adults = await query(driver, User)
  .where('age', '>=', 18)
  .orderBy('age', 'desc')
  .limit(20)
  .get();

console.log(adults.data);
```

Column names are checked against the struct at compile time, every value is bound, and `get()` returns a `Result` like the CRUD functions. [Queries](queries.md) covers the full operator set, `OR` groups, `IN` and `BETWEEN`, escaped `LIKE` search, aggregates, and pagination.

## Move up to models

A model binds one driver and one struct into a class you can extend with your own methods. Instances track which fields changed, so `save()` writes only those columns:

```ts
import { defineModel } from '@velkymx/ts-orm';

class AppUser extends defineModel(driver, User) {
  greeting() {
    return `Hello, ${this.toRow().name}`;
  }
}

const user = await AppUser.create({ name: 'Ada', age: 36 });

const same = await AppUser.find(user.toRow().id);
same.fill({ age: 37 });
await same.save(); // UPDATE ... SET age = ? only

await same.delete();
```

Models are where hooks, automatic timestamps, attribute casts, and soft deletes live. [Models](models.md) walks through each one, starting from the plain class above.

## Where to go next

You now have the whole surface in miniature: a driver, a struct, CRUD, a query, and a model. The rest of the documentation takes each of those further. [Queries](queries.md) and [Models](models.md) are the common next stops; [Relations](relations.md), [Transactions](transactions.md), and [Schema and migrations](schema-and-migrations.md) cover the larger pieces when you need them.
