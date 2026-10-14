# Schema and migrations

ts-orm builds DDL from the same structs that drive everything else, and runs ordered migrations against a tracking table. This page starts with a single generated statement and builds up to a versioned migration and the CLI.

## Generate a CREATE TABLE from a struct

`structColumns` folds a struct into column definitions, and `buildCreateTable` compiles them to DDL for a dialect. The result is a string you run through the driver:

```ts
import {
  defineStruct, createSqliteDriver, structColumns, buildCreateTable,
} from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });

const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
});

const sql = buildCreateTable(driver.dialect, 'posts', structColumns(Post));
await driver.execute(sql, []);
```

`buildCreateTable` is safe to rerun: it emits `IF NOT EXISTS`, or an `OBJECT_ID` guard on SQL Server, and uses each engine's native strategy for auto-increment primary keys.

## The rest of the schema builder

The builder has one function per operation, each taking the dialect first:

```ts
import {
  buildAddColumn, buildDropColumn,
  buildCreateIndex, buildDropIndex, buildAddForeignKey,
} from '@velkymx/ts-orm';

buildAddColumn(driver.dialect, 'posts', 'summary', { type: 'string', length: 200 });
buildDropColumn(driver.dialect, 'posts', 'summary');

buildCreateIndex(driver.dialect, 'posts', ['title'], { unique: true });
buildDropIndex(driver.dialect, 'posts', 'posts_title_index');

buildAddForeignKey(driver.dialect, 'comments', 'post_id', { table: 'posts', column: 'id' });
```

Column definitions take the same shape as a struct field plus a few DDL-only options (`primaryKey`, `autoIncrement`, `unique`, and `references` with an optional `onDelete`). SQLite cannot add or drop constraints after a table exists, so `buildAddForeignKey` throws for it; define those references inline in `buildCreateTable` instead.

## Write a migration

A migration is a plain object with a `name` and two functions. `up` applies the change and `down` reverses it. Use the schema builder inside them so one migration targets every engine:

```ts
const createPosts = {
  name: '20240101000000_create_posts',
  up: async (d) => {
    await d.execute(buildCreateTable(d.dialect, 'posts', structColumns(Post)), []);
    await d.execute(buildCreateIndex(d.dialect, 'posts', ['title'], {}), []);
  },
  down: async (d) => {
    await d.execute('DROP TABLE "posts"', []);
  },
};
```

The timestamp prefix in the name sets the order. Keep it, because the runner sorts by name.

## Run and roll back

`migrate` applies every migration not yet recorded, oldest first, and records each success in a `tsorm_migrations` table. Running it again applies nothing:

```ts
import { migrate, rollback } from '@velkymx/ts-orm';

const applied = await migrate(driver, [createPosts]);
console.log(applied.applied); // ['20240101000000_create_posts']
console.log(applied.batch);   // 1

const again = await migrate(driver, [createPosts]);
console.log(again.applied);   // [] nothing to do
```

A migration whose `up` throws stops the run without being recorded, so the next run retries exactly the remainder. `rollback` reverses the latest batch, newest first, and throws on a name it was not given rather than guessing:

```ts
const reverted = await rollback(driver, [createPosts]);
console.log(reverted.reverted); // ['20240101000000_create_posts']
```

DDL is not transactional on every engine, so the runner records each migration after its `up` succeeds and leans on `IF NOT EXISTS` for safe retries rather than wrapping the batch in one transaction.

## The CLI

The CLI runs the same runner against files on disk. Scaffold a migration, apply pending ones, and roll back the last batch:

```bash
npx ts-orm make:migration add_posts
npx ts-orm migrate
npx ts-orm migrate:rollback
```

`make:migration` writes a timestamped file with `up` and `down` stubs into `./migrations`. `migrate` loads every `.js` or `.mjs` file there, oldest first, and applies the pending ones. `migrate:rollback` reverses the latest batch. The CLI resolves files against your working directory and connects with the same environment settings as the rest of the library.
