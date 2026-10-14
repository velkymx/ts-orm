# Relations

A relation binds two structs by the columns that connect them. You declare the relation, then `load` resolves it for many parent rows at once, and `deleteRelated` removes dependent rows. Loading is batched: it runs one query per table (two across a pivot), never one query per parent.

The examples use an author with articles and roles:

```ts
import {
  defineStruct, createSqliteDriver,
  hasMany, belongsToMany, load, deleteRelated,
} from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });

const Author = defineStruct('authors', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

const Article = defineStruct('articles', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  author_id: { type: 'number', required: true },
  title: { type: 'string', required: true, length: 120 },
});
```

## The simplest relation: hasMany

`hasMany(source, target, foreignKey)` says each author has many articles, matched by `articles.author_id`. Pass the relation and the parent rows to `load`. It returns a `Map` keyed by the parent key, with an array of children per key:

```ts
const parents = [{ id: 1 }, { id: 2 }];
const byAuthor = await load(driver, hasMany(Author, Article, 'author_id'), parents);

console.log(byAuthor.get(1)); // [{ id: 1, author_id: 1, title: 'notes' }, ...]
console.log(byAuthor.get(2)); // [] when an author has none
```

`load` collects the distinct parent keys, issues one `WHERE author_id IN (...)`, and groups the results in memory. Two authors or two thousand, it is still one query. Parents may be plain rows or hydrated model instances; instances unwrap to their attributes.

## The relation kinds

Each kind takes the two structs plus the keys that join them. The foreign key lives on whichever side holds it.

`hasOne` and `hasMany` point from a parent to children that carry its key. `belongsTo` points the other way, from rows that carry a foreign key to the owner they reference:

```ts
import { hasOne, belongsTo } from '@velkymx/ts-orm';

hasOne(Author, Article, 'author_id');          // author has one article
belongsTo(Article, Author, 'author_id');       // article belongs to an author
```

`belongsToMany` reaches a target through a pivot table, naming the pivot struct and both of its foreign keys:

```ts
const Role = defineStruct('roles', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 30 },
});

const AuthorRole = defineStruct('author_role', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  author_id: { type: 'number', required: true },
  role_id: { type: 'number', required: true },
});

const roles = await load(
  driver,
  belongsToMany(Author, Role, AuthorRole, 'author_id', 'role_id'),
  [{ id: 1 }],
);
console.log(roles.get(1)); // the roles for author 1
```

`morphMany` loads polymorphic children that share one table, scoped by a type column and a value, so comments on both posts and photos can live in one `comments` table.

## Loading a single parent

When you have one parent and want the single related row, `loadOne` covers `hasOne` and `belongsTo`. It returns the row or `null`:

```ts
import { loadOne } from '@velkymx/ts-orm';

const author = await loadOne(driver, belongsTo(Article, Author, 'author_id'), { author_id: 1 });
```

## Deleting dependents

`deleteRelated` removes the children for a set of parent keys in one statement. Its mode sets the contract explicitly:

```ts
const rel = hasMany(Author, Article, 'author_id');

await deleteRelated(driver, rel, [1], 'force');  // physically delete children
await deleteRelated(driver, rel, [1], 'soft');   // stamp children that support soft deletes
await deleteRelated(driver, rel, [1], 'ignore'); // touch nothing, return 0
```

`force` is the default. `soft` stamps the child delete column and skips already-stamped rows, and it throws if the child struct has no such column. For a many-to-many relation every mode detaches the pivot links physically, because a shared target must not vanish when one parent lets go. `belongsTo` owns no rows and throws in every mode. These are bulk paths, so they fire no model hooks.

## Soft deletes and relations

When a target struct declares a `deleted_at` column, `load` hides stamped rows by default, whether or not any model flag is set. This is a struct-level decision, so even a raw `load` respects it. Pass `{ withTrashed: true }` to include them:

```ts
const live = await load(driver, rel, [{ id: 1 }]);
const all = await load(driver, rel, [{ id: 1 }], { withTrashed: true });
```
