# Queries

The query builder turns a chain of method calls into one parameterized statement. Start a chain with `query(driver, struct)`, add conditions, and finish with a method that runs it. This page starts with a single condition and works up to grouped logic, aggregates, and pagination.

Every example assumes a `User` struct and a `driver`:

```ts
import { defineStruct, createSqliteDriver, query } from '@velkymx/ts-orm';

const driver = createSqliteDriver({ filename: ':memory:' });

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
  age: { type: 'number' },
  role: { type: 'string' },
});
```

## One condition

`where` takes a column, an operator, and a value. The column is checked against the struct, so a typo is a compile error, and the value is bound, never pasted into the SQL:

```ts
const staff = await query(driver, User).where('role', '=', 'staff').get();
```

When the operator is `=`, you can drop it:

```ts
const staff = await query(driver, User).where('role', 'staff').get();
```

`get()` returns a `Result`. Read `data` after checking `success`:

```ts
const result = await query(driver, User).where('role', 'staff').get();
if (result.success) {
  for (const row of result.data) console.log(row.name);
}
```

## Chaining conditions

Each extra `where` adds an `AND`. The operators are `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`, and `LIKE`:

```ts
const result = await query(driver, User)
  .where('age', '>=', 18)
  .where('role', '!=', 'banned')
  .get();
```

## Ordering and limiting

`orderBy` takes a column and a direction, defaulting to ascending. `limit` and `offset` bound the window; non-integer or negative values are ignored rather than producing broken SQL:

```ts
const page = await query(driver, User)
  .where('age', '>=', 18)
  .orderBy('age', 'desc')
  .limit(10)
  .offset(20)
  .get();
```

## Selecting columns

By default a query selects every column. Narrow it with `select`, which also narrows the row type: `get`, `first`, and `paginate` return only the picked columns, and reading anything else fails typecheck. Narrowing follows the chain, so conditions after `select` keep it:

```ts
const names = await query(driver, User).select('id', 'name').get();
```

## IN, BETWEEN, and NULL

These read as their SQL counterparts. An empty `IN` list compiles to a condition that matches nothing, and an empty `NOT IN` list matches everything, so you never emit invalid SQL for an empty array:

```ts
const some = await query(driver, User).whereIn('role', ['admin', 'staff']).get();
const none = await query(driver, User).whereNotIn('role', ['banned']).get();

const middle = await query(driver, User).whereBetween('age', 18, 65).get();

const unset = await query(driver, User).whereNull('role').get();
const set = await query(driver, User).whereNotNull('role').get();
```

Each of these has an `or` sibling (`orWhereIn`, `orWhereBetween`, `orWhereNull`, and so on) for use inside `OR` logic.

## Searching with LIKE

`whereLike` wraps the value in `%...%` and escapes any `%` or `_` the user typed, so their input is treated as literal text rather than wildcards:

```ts
const found = await query(driver, User).whereLike('name', 'ada').get();
```

When you want wildcard control yourself, use the `LIKE` operator with `where` and supply your own pattern. That path does not escape, by design.

## OR and grouped logic

`orWhere` joins with `OR` instead of `AND`. To keep precedence clear, pass a callback that receives a fresh builder; its conditions compile inside parentheses:

```ts
const result = await query(driver, User)
  .where('age', '<', 18)
  .orWhere((b) => b.where('role', 'admin').where('name', 'LIKE', '%o%'))
  .get();
// WHERE age < ? OR (role = ? AND name LIKE ?)
```

Grouping matters: without the parentheses, a trailing `OR` would widen the whole statement.

## Reading one row

`first` runs the query with a limit of one and returns the row or `null`:

```ts
const youngest = await query(driver, User).orderBy('age', 'asc').first();
if (youngest.success && youngest.data) console.log(youngest.data.name);
```

## Counting and aggregates

`count` reuses the current filters and ignores ordering and paging. `sum`, `avg`, `min`, and `max` aggregate one column and return `null` when no rows match:

```ts
const adults = await query(driver, User).where('age', '>=', 18).count();
console.log(adults.data); // a number

const oldest = await query(driver, User).max('age');
const average = await query(driver, User).where('role', 'staff').avg('age');
```

## Pagination

`paginate` composes a count with one bounded page into a totals envelope. It clamps the page to at least 1 and the page size to between 1 and 100, so hostile input cannot request the whole table:

```ts
const result = await query(driver, User).orderBy('age', 'asc').paginate(1, 20);
console.log(result.total, result.lastPage, result.data);
```

Unlike the other runners, `paginate` returns the page directly and throws if the underlying count or read fails, since there is no partial page to report.

## Deleting

`delete` runs a `DELETE` over the current filters and reports how many rows it removed:

```ts
const removed = await query(driver, User).where('role', 'banned').delete();
console.log(removed.data.affectedRows);
```

## Inspecting the SQL

Every runner has a compile-only counterpart that returns the statement and its bound parameters without touching the database. Use them to debug or to hand the SQL to something else:

```ts
const { sql, params } = query(driver, User).whereBetween('age', 18, 35).toSQL();
console.log(sql);    // SELECT * FROM "users" WHERE "age" BETWEEN ? AND ?
console.log(params); // [18, 35]
```

`toCountSQL` and `toDeleteSQL` do the same for counts and deletes.
