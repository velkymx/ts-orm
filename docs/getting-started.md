# Getting started

## Installation

```bash
npm i @velkymx/ts-orm
```

Peer drivers are optional and installed only for the engines you use:

```bash
npm i pg        # Postgres
npm i mssql     # SQL Server / Azure SQL
```

MySQL rides on the `mysql2` dependency. SQLite uses the built-in
`node:sqlite`, so it needs Node 24 or later and no extra package.

## Configuration

Pass config explicitly or through the environment. Missing required keys
fail fast with a clear message instead of an opaque connection error.

```ts
import { configure } from '@velkymx/ts-orm';

configure({
  host: '127.0.0.1',
  user: 'dbuser',
  password: 'password',
  database: 'ts-orm',
  port: 3306,
});
```

Environment equivalents are `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
`DB_DATABASE`, and `DB_PORT` (default 3306). Postgres and MSSQL take the
same shape through `configurePostgres` and `configureMssql`. SQLite takes a
file path: `createSqliteDriver({ filename: './app.db' })`, default `:memory:`.

Release resources when done so scripts and tests exit cleanly:

```ts
import { closePool } from '@velkymx/ts-orm';

await driver.close();
await closePool();
```

## First model

Declare the table once. Row, insert, and update shapes are inferred, never
redeclared, so types and runtime cannot drift.

```ts
import { defineStruct, createMysqlDriver, defineModel } from '@velkymx/ts-orm';

const driver = createMysqlDriver();
const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
  role: { type: 'string' },
});

class AppUser extends defineModel(driver, User) {}

const created = await AppUser.create({ name: 'Ada', age: 36 });
const found = await AppUser.find(created.toRow().id);
found.fill({ age: 37 });
await found.save(); // writes only the changed column
await found.delete();
```

Field types are `number`, `string`, `uuid`, `date`, `datetime`,
`boolean`, and `enum`. Mark a key `required`, cap text with `length`,
leave inserts to the database with `default`, and list allowed values
with `enum`.

## First query

```ts
import { query } from '@velkymx/ts-orm';

const adults = await query(driver, User)
  .where('age', '>=', 18)
  .whereIn('role', ['admin', 'staff'])
  .orderBy('age', 'desc')
  .limit(20)
  .get();

const total = await query(driver, User).where('age', '>=', 18).count();
```

Every column is validated, every value bound. The full operator set,
`OR` groups, `LIKE` escaping, and transactions are covered in
[Architecture](architecture.md) and in `examples/`.
