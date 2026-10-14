# Models

A model binds one driver and one struct into a class. You get static finders, instances that track their own changes, and a set of opt-in features (hooks, timestamps, casts, soft deletes) layered on top. This page starts with a plain model and adds one feature at a time.

## Define a model

Call `defineModel(driver, struct)` and extend the result. The base class gives you the static and instance methods; your subclass adds whatever domain logic you want:

```ts
import { defineStruct, createSqliteDriver, defineModel } from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
});

class AppUser extends defineModel(driver, User) {
  display() {
    const row = this.toRow();
    return `${row.name} (${row.age})`;
  }
}
```

## Create, find, and list

The static methods return instances, not raw rows. `create` validates and inserts, `find` returns an instance or `null`, `findOrFail` throws `NotFoundError` when the row is missing, and `all` returns every row as instances:

```ts
const user = await AppUser.create({ name: 'Ada', age: 36 });
console.log(user.display()); // Ada (36)

const byId = await AppUser.find(user.toRow().id);
const required = await AppUser.findOrFail(1);
const everyone = await AppUser.all();
```

Each of these takes an optional driver as its last argument, which is how a model write joins a transaction. See [Transactions](transactions.md).

## Dirty tracking and save

An instance remembers the values it was hydrated with. `fill` merges new values, `isDirty` reports whether anything changed, and `getChanges` returns only the changed fields. `save` inserts when the instance has no primary key and otherwise updates, writing only the dirty columns:

```ts
const user = await AppUser.find(1);
user.fill({ age: 37 });

console.log(user.isDirty());     // true
console.log(user.getChanges());  // { age: 37 }

await user.save();               // UPDATE ... SET age = ? WHERE id = ?
console.log(user.isDirty());     // false

await user.delete();
```

A `save` on an unchanged instance does nothing and issues no SQL.

## Query and bulk delete

`Model.query()` returns a query builder already bound to the model, so you get the full builder surface from [Queries](queries.md). `deleteWhere` removes rows matching an equality set in one statement:

```ts
const staff = await AppUser.query().where('age', '>=', 18).get();

const removed = await AppUser.deleteWhere({ age: 0 });
console.log(removed.affectedRows);
```

## Lifecycle hooks

Set a static `hooks` object to run code around writes. Before-hooks run first and can veto the write by throwing; after-hooks run once the write is durable. The hook names are `saving`, `creating`, `created`, `saved`, `updating`, `updated`, `deleting`, `deleted`, `restoring`, `restored`, `forceDeleting`, and `forceDeleted`.

```ts
class AppUser extends defineModel(driver, User) {
  static hooks = {
    creating: (ctx) => {
      if (!ctx.attributes.name) throw new Error('name is required');
    },
    created: (ctx) => {
      console.log('created user', ctx.attributes.name);
    },
  };
}
```

A create fires `saving`, then `creating`, then the insert, then `created`, then `saved`. A dirty update fires `saving`, `updating`, the update, `updated`, `saved`. The after-hooks (`created`, `updated`, `saved`, and the delete and restore pairs) run after the write commits, not merely after the SQL runs. Inside a transaction they are held and delivered when the outer transaction commits, so a hook never reports a write that later rolls back. [Transactions](transactions.md) shows that ordering.

The direct CRUD functions never fire hooks. Bulk paths like `deleteWhere` and relation deletes are also hook-free. Hooks are a model concern only.

## Automatic timestamps

If the struct has `created_at` or `updated_at` columns, the model fills them for you. `created_at` is set on insert when you did not supply one; `updated_at` is refreshed on every update:

```ts
const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  created_at: { type: 'datetime' },
  updated_at: { type: 'datetime' },
});

class AppPost extends defineModel(driver, Post) {}

const post = await AppPost.create({ title: 'hello' });
console.log(post.toRow().created_at); // 2024-05-01 10:00:00
```

Timestamps are on by default and gated by column presence, so a struct without those columns pays nothing. Opt out per model with `static timestamps = false`.

## Attribute casts

Casts translate between how a value is stored and how your application uses it. Set a static `casts` map from column to one of `boolean`, `integer`, `datetime`, or `json`:

```ts
const Item = defineStruct('items', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  active: { type: 'number' },
  meta: { type: 'string' },
  seen_at: { type: 'string' },
});

class AppItem extends defineModel(driver, Item) {
  static casts = { active: 'boolean', meta: 'json', seen_at: 'datetime' };
}

const item = await AppItem.create({
  active: true,
  meta: { tags: ['a', 'b'] },
  seen_at: new Date('2024-05-01T10:00:00Z'),
});

console.log(item.toRow().active); // true, not 1
console.log(item.toRow().meta);   // { tags: ['a', 'b'] }, not a string
```

Casts apply at the model layer only; raw builder rows stay in their storage form. Dirty tracking compares normalized values, so filling `active` with `1` when it already holds `true` does not mark the instance dirty, and a JSON column is only considered changed when its parsed value differs. A value that cannot be cast throws `CastError` naming the column, and `null` stays `null` in both directions.

## Soft deletes

Soft deletes keep rows in the table and hide them behind a stamped column. Turn them on with `static softDeletes = true` and a `deleted_at` column. The flag without the column throws on every soft path, so you cannot accidentally delete rows physically.

```ts
const Post = defineStruct('posts', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  title: { type: 'string', required: true, length: 120 },
  deleted_at: { type: 'datetime' },
});

class AppPost extends defineModel(driver, Post) {
  static softDeletes = true;
}

const post = await AppPost.create({ title: 'hello' });
await post.delete();              // stamps deleted_at, fires deleting/deleted

console.log(await AppPost.find(1)); // null, hidden by default
```

Model reads (`find`, `findOrFail`, `all`, `query`) hide stamped rows while the flag is set. To see trashed rows, go through `withTrashed`:

```ts
const trashed = await AppPost.withTrashed().find(1);
console.log(trashed.toRow().title); // hello
```

`restore` clears the stamp and fires `restoring` and `restored`; `forceDelete` removes the row physically and fires `forceDeleting` and `forceDeleted`:

```ts
const found = await AppPost.withTrashed().find(1);
await found.restore();      // visible again
await found.forceDelete();  // gone for good
```

Repeat actions are no-ops rather than errors: deleting an already-trashed instance and restoring a live one do nothing. `Model.delete` never cascades to related rows; compose that explicitly with [relations](relations.md).
