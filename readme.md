# ✨ VibeORM

*The MySQL ORM with good vibes* ✨

A lightweight, powerful ORM for Node.js with an **Eloquent-like Model API** and advanced query builder. Define schemas using JSON structs, or auto-generate them from your existing database.

---

## 🚀 Features

### Core Features
- ✅ **Eloquent-like Model API** - Clean, chainable syntax
- ✅ **Advanced Query Builder** - Complex WHERE clauses, JOINs, aggregates
- ✅ **Auto-generate structs from database** - CLI tool inspects your tables
- ✅ **Enterprise-grade security** - SQL injection prevention, input validation
- ✅ **Full CRUD operations** - Create, Read, Update, Delete
- ✅ **Type validation** - UUID, datetime, date, boolean, enum
- ✅ Built on MySQL2 with connection pooling

### Query Builder
- ✅ WHERE clauses: `where()`, `orWhere()`, `whereIn()`, `whereNull()`, `whereLike()`
- ✅ Advanced WHERE: `whereAny()`, `whereAll()`, `whereNone()`
- ✅ JOINs: `innerJoin()`, `leftJoin()`, `rightJoin()`
- ✅ Aggregates: `count()`, `sum()`, `avg()`, `max()`, `min()`
- ✅ Utilities: `orderBy()`, `limit()`, `offset()`, `pluck()`

---

## 🔒 Security (v1.5.0+)

**vibeorm** now includes enterprise-grade security features:

### SQL Injection Prevention
All table names, column names, and ORDER BY clauses are validated and escaped to prevent SQL injection attacks.

### Input Validation
- **UUID**: Validates proper UUID v4 format
- **Datetime**: Validates `YYYY-MM-DD HH:MM:SS` format with range checks
- **Date**: Validates `YYYY-MM-DD` format with range checks
- **Boolean**: Type-checks boolean values (accepts `true`, `false`, `0`, `1`)
- **Enum**: Properly handles `null`/`undefined` for non-required fields

### Error Sanitization
Database errors are sanitized to prevent schema information leakage:
- Duplicate key errors → "Record already exists"
- Foreign key violations → Safe descriptive messages
- Full errors logged server-side for debugging
- Generic messages returned to clients

---

## ⚠️ Breaking Changes in v1.5.0

### Identifier Validation
Table and column names must now contain only alphanumeric characters and underscores (`[a-zA-Z0-9_]`). Special characters like spaces, quotes, or semicolons will be rejected.

**Before v1.5.0**: Any identifier accepted (security risk)
**After v1.5.0**: Only safe identifiers allowed

```javascript
// ✅ Valid identifiers
await create('users', struct, payload);
await create('user_profiles', struct, payload);
await create('users_2024', struct, payload);

// ❌ Invalid identifiers (will throw error)
await create('users; DROP TABLE', struct, payload); // SQL injection attempt
await create('user profiles', struct, payload);     // Contains space
await create('users-table', struct, payload);       // Contains hyphen
```

### Error Messages
Error messages are now sanitized and more generic to prevent information leakage.

**Before v1.5.0**: `"DB Error: Duplicate entry 'john@example.com' for key 'users.email'"`
**After v1.5.0**: `"Record already exists"`

Full error details are logged server-side with `console.error()` for debugging.

---

## 📦 Installation

```bash
npm install vibeorm
```

## ⚙️ Setup

Create a `.env` file in your project root:

```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_DATABASE=your_database
```

---

## 🚀 Getting Started in 3 Steps

### Step 1: Configure Database Connection

Create `.env` file:
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=myapp
```

### Step 2: Generate Structs from Your Tables

```bash
# Generate struct for your users table
npx vibeorm struct users

# Output: users.json created ✅
```

### Step 3: Start Building Queries

```js
import { model } from 'vibeorm';
import userStruct from './users.json' assert { type: 'json' };

const User = model('users', userStruct);

// That's it! Start querying:
const activeUsers = await User.where('status', 'active').get();
const user = await User.find('user-uuid-123');
await User.create({ name: 'Alice', email: 'alice@example.com' });
```

**You're ready to go!** 🎉

---

## 🔧 CLI Tool: Auto-Generate Structs from Your Database

The fastest way to get started is to use the CLI tool to generate struct definitions from your existing database tables.

### Step 1: Generate a Struct

```bash
npx vibeorm struct users
```

**Output:** Creates `users.json` with your table structure:

```json
[
  {
    "name": "id",
    "type": "uuid",
    "required": true,
    "length": 36,
    "default": ""
  },
  {
    "name": "name",
    "type": "string",
    "required": true,
    "length": 128,
    "default": ""
  },
  {
    "name": "email",
    "type": "string",
    "required": true,
    "length": 256,
    "default": ""
  },
  {
    "name": "created_at",
    "type": "datetime",
    "required": true,
    "length": 19,
    "default": "current_timestamp"
  }
]
```

### Step 2: Import and Use the Struct

```js
import { model } from 'vibeorm';
import userStruct from './users.json' assert { type: 'json' };

// Create a model
const User = model('users', userStruct);

// Start querying!
const activeUsers = await User.where('status', 'active').get();
```

### Generate Multiple Structs

```bash
# Generate structs for multiple tables
npx vibeorm struct users
npx vibeorm struct posts
npx vibeorm struct comments

# Or use a shell loop
for table in users posts comments; do npx vibeorm struct $table; done
```

**What the CLI Does:**
- ✅ Connects to your database using `.env` credentials
- ✅ Inspects the table structure (columns, types, constraints)
- ✅ Intelligently maps MySQL types to ORM types
- ✅ Detects UUIDs (CHAR/VARCHAR(36) fields with 'id' in name)
- ✅ Identifies auto-increment fields
- ✅ Handles enums, dates, timestamps automatically
- ✅ Outputs ready-to-use JSON struct file

---

## 📚 Usage Examples

### 🆕 New Model API (Recommended)

The **Model API** provides a clean, Eloquent-like interface while maintaining full backward compatibility:

```js
import { model } from 'vibeorm';

// Define your struct once
const userStruct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "name", type: "string", required: true, length: 128, default: "" },
  { name: "email", type: "string", required: true, length: 256, default: "" },
  { name: "status", type: "enum", enum: ["active", "inactive"], default: "active" },
  { name: "age", type: "number", required: false, default: null },
  { name: "created_at", type: "datetime", required: true, default: "current_timestamp" }
];

// Create a model
const User = model('users', userStruct);

// Clean, powerful API:
const user = await User.find('123e4567-...');
const users = await User.where('status', 'active').get();
const count = await User.where('age', '>', 18).count();
await User.create({ name: 'Alice', email: 'alice@example.com' });
```

### Classic Function-Based API

```js
import { create, read, update, remove } from 'vibeorm';

const table = 'users';

const userStruct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "name", type: "string", required: true, length: 128, default: "" },
  { name: "email", type: "string", required: true, length: 256, default: "" },
  { name: "created_at", type: "datetime", required: true, default: "current_timestamp" }
];

const result = await create(table, userStruct, {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  created_at: '2025-04-07 10:00:00'
});

const result = await read('users', { id: '123e4567-e89b-12d3-a456-426614174000' });
console.log(result);

const updatedUser = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice Updated'
};

const result = await update('users', userStruct, updatedUser);
console.log(result);

const result = await remove('users', 'id', '123e4567-e89b-12d3-a456-426614174000');
console.log(result);
```

## Handling Create Success or Failure with vibeorm

Using the above defined `userStruct`, you can use `vibeorm` to attempt to create a record and handle the result accordingly.

### Example

```js
import { create } from 'vibeorm';

const table = 'users';

const userStruct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "name", type: "string", required: true, length: 128, default: "" },
  { name: "email", type: "string", required: true, length: 256, default: "" },
  { name: "created_at", type: "datetime", required: true, default: "current_timestamp" }
];

const payload = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: '', // This should trigger a validation error if email is required
  created_at: '2025-04-07 10:00:00'
};

async function tryCreateUser() {
  const result = await create(table, userStruct, payload);

  if (result.success) {
    console.log('User created successfully:', result.data);
  } else {
    console.error('Failed to create user:');
    console.error('Message:', result.message);
    console.error('Details:', result.data);
  }
}

tryCreateUser();
```

### Output on Validation Failure
```
Failed to create user:
Message: Validation failed
Details: [ 'email is required' ]
```

### Output on Invalid UUID (v1.5.0+)
```
Failed to create user:
Message: Validation failed
Details: [ 'id must be a valid UUID' ]
```

### Output on Duplicate Key (v1.5.0+)
```
Failed to create user:
Message: Database operation failed
Details: Record already exists
```
*Note: Full error details are logged server-side for debugging*

### Output on Success
```
User created successfully: { id: 1 }
```

## Using vibeorm in an ExpressJS Controller

Here's how you can integrate `vibeorm` into an Express route handler to create a record and return a proper JSON API response.

### Example

```js
import express from 'express';
import { create } from 'vibeorm';
import { userStruct } from './structs/user.js'; // Your predefined struct

const router = express.Router();

router.post('/api/users', async (req, res) => {
  const payload = req.body;
  const table = 'users';

  try {
    const result = await create(table, userStruct, payload);

    if (result.success) {
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
        errors: result.data
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  }
});

export default router;
```


## 📘 Struct Field Types

| Type         | Description                          | Example Value                          | Validation (v1.5.0+)                                              | Notes                                              |
|--------------|--------------------------------------|----------------------------------------|------------------------------------------------------------------|----------------------------------------------------|
| `uuid`       | Universally unique identifier        | `"123e4567-e89b-12d3-a456-426614174000"` | **Must match UUID v4 format** (validated)                        | Regex pattern validated                          |
| `string`     | Text string                          | `"Alice"`                               | Length validation only                                            | `length` defines max characters allowed            |
| `number`     | Integer or float                     | `42`                                     | Type validation (isNaN check)                                     | Used for numeric fields including IDs              |
| `datetime`   | Date and time                        | `"2025-04-07 10:00:00"`                 | **Must match `YYYY-MM-DD HH:MM:SS` format** with range checks    | Format and validity validated                      |
| `date`       | Date only                            | `"2025-04-07"`                          | **Must match `YYYY-MM-DD` format** with range checks             | Format and validity validated                      |
| `boolean`    | Boolean flag                         | `true`, `false`, `0`, `1`               | **Type-checked** (boolean, 0, 1, '0', '1' allowed)               | Stored as TINYINT in MySQL                         |
| `enum`       | Predefined set of valid strings      | `"percent"` or `"flat"`                | Validates value in enum array; allows null for non-required     | Must define `enum: [...]` in struct                |
| `auto_increment` | Special case for `number` fields   | Not passed on insert                    | Cannot be manually provided on insert                            | Use `"default": "auto_increment"` in struct config |

### Validation Examples

```javascript
// ✅ Valid values (will pass validation)
const validPayload = {
  id: '123e4567-e89b-12d3-a456-426614174000',  // Valid UUID v4
  created_at: '2025-04-07 10:30:00',           // Valid datetime
  birth_date: '1990-05-15',                    // Valid date
  is_active: true,                             // Valid boolean
  commission_type: 'percent'                   // Valid enum value
};

// ❌ Invalid values (will fail validation)
const invalidPayload = {
  id: 'not-a-valid-uuid',                      // Invalid UUID format
  created_at: '2025/04/07 10:30:00',           // Invalid datetime format (slashes)
  birth_date: '04-07-2025',                    // Invalid date format
  is_active: 'yes',                            // Invalid boolean
  commission_type: 'invalid'                   // Not in enum array
};
```


## 🚀 Model API Features

The Model API provides powerful query building capabilities while maintaining the same security and validation as the classic API.

### Basic Operations

```js
const User = model('users', userStruct);

// Find by ID
const user = await User.find('123e4567-...');

// Find or throw error
const user = await User.findOrFail('123e4567-...');

// Get all records
const result = await User.all();

// Get first record matching condition
const result = await User.first({ status: 'active' });

// Create new record
await User.create({
  id: uuidv4(),
  name: 'Alice',
  email: 'alice@example.com',
  status: 'active'
});

// Update record
await User.update({
  id: '123e4567-...',
  name: 'Alice Updated'
});

// Delete record
await User.delete('123e4567-...');
```

### Query Builder - WHERE Clauses

```js
// Simple equality
const active = await User.where('status', 'active').get();

// With operators (=, !=, >, <, >=, <=)
const adults = await User.where('age', '>', 18).get();
const young = await User.where('age', '<', 30).get();
const notAdmin = await User.where('role', '!=', 'admin').get();

// WHERE NOT (shorthand for !=)
const result = await User.whereNot('status', 'banned').get();

// Multiple conditions (AND)
const result = await User
  .where('status', 'active')
  .where('age', '>', 18)
  .get();

// OR conditions
const result = await User
  .where('status', 'active')
  .orWhere('status', 'pending')
  .get();

// WHERE IN
const result = await User
  .whereIn('status', ['active', 'pending'])
  .get();

// WHERE NOT IN
const result = await User
  .whereNotIn('role', ['guest', 'banned'])
  .get();

// WHERE NULL
const noLogin = await User.whereNull('last_login').get();

// WHERE NOT NULL
const hasAge = await User.whereNotNull('age').get();

// LIKE queries
const users = await User.whereLike('email', '%@gmail.com').get();
const search = await User.whereLike('name', 'John%').get();
const notGmail = await User.whereNotLike('email', '%@gmail.com').get();

// OR LIKE
const result = await User
  .whereLike('name', 'John%')
  .orWhereLike('name', 'Jane%')
  .get();

// Object-style conditions
const result = await User.where({ status: 'active', role: 'admin' }).get();
```

### Query Builder - Advanced WHERE

```js
// WHERE ANY - value matches ANY of the columns
const result = await User
  .whereAny(['email', 'phone', 'username'], 'john@example.com')
  .get();
// SQL: WHERE (email = ? OR phone = ? OR username = ?)

// WHERE ALL - value matches ALL of the columns
const result = await User
  .whereAll(['status', 'verification_status'], 'active')
  .get();
// SQL: WHERE (status = ? AND verification_status = ?)

// WHERE NONE - value matches NONE of the columns
const result = await User
  .whereNone(['status', 'account_status'], 'banned')
  .get();
// SQL: WHERE (status != ? AND account_status != ?)
```

### Query Builder - JOINs

```js
// INNER JOIN
const result = await User
  .innerJoin('posts', 'users.id', 'posts.user_id')
  .where('users.status', 'active')
  .get();

// LEFT JOIN
const result = await User
  .leftJoin('profiles', 'users.id', 'profiles.user_id')
  .whereNull('profiles.id')
  .get();

// RIGHT JOIN / OUTER JOIN
const result = await User
  .rightJoin('orders', 'users.id', 'orders.user_id')
  .get();

// Multiple JOINs
const result = await User
  .innerJoin('posts', 'users.id', 'posts.user_id')
  .leftJoin('comments', 'posts.id', 'comments.post_id')
  .where('users.status', 'active')
  .get();

// JOIN with custom operators
const result = await User
  .innerJoin('posts', 'users.id', '!=', 'posts.author_id')
  .get();
```

### Query Builder - Ordering & Pagination

```js
// Order by
const sorted = await User.orderBy('created_at', 'DESC').get();

// Limit
const top10 = await User.limit(10).get();

// Offset
const skip5 = await User.offset(5).get();

// Pagination (combine limit + offset)
const page2 = await User
  .orderBy('created_at', 'DESC')
  .limit(20)
  .offset(20)
  .get();

// Get first result
const newest = await User
  .orderBy('created_at', 'DESC')
  .first();
```

### Query Builder - Aggregates

```js
// Count
const total = await User.count();
const activeCount = await User.where('status', 'active').count();

// Sum
const totalBalance = await User.sum('balance');

// Average
const avgAge = await User.avg('age');

// Max
const oldestAge = await User.max('age');

// Min
const youngestAge = await User.min('age');

// Combine with conditions
const activeBalance = await User
  .where('status', 'active')
  .sum('balance');
```

### Query Builder - Pluck

Extract a single column's values as an array:

```js
// Simple pluck
const result = await User.pluck('email');
// result.data = ['alice@example.com', 'bob@example.com', ...]

// Pluck with conditions
const emails = await User.pluck('email', { status: 'active' });

// Pluck with query builder
const names = await User
  .where('status', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .pluck('name');
// names.data = ['Alice', 'Bob', 'Charlie', ...]

// Pluck IDs
const ids = await User.whereIn('role', ['admin', 'moderator']).pluck('id');
```

### Complex Queries

```js
// Combine everything
const result = await User
  .whereIn('status', ['active', 'pending'])
  .where('age', '>=', 18)
  .where('balance', '>', 0)
  .whereNotNull('email')
  .orderBy('created_at', 'DESC')
  .limit(50)
  .offset(0)
  .get();

// Get single result
const topUser = await User
  .where('status', 'active')
  .orderBy('balance', 'DESC')
  .first();

// Count with complex conditions
const count = await User
  .whereIn('role', ['admin', 'moderator'])
  .where('last_login', '>', '2025-01-01 00:00:00')
  .count();
```

### Response Format

All Model API methods return the same consistent format as the classic API:

```js
// Success:
{
  success: true,
  message: 'Data retrieved',
  data: [...]
}

// Validation error:
{
  success: false,
  message: 'Validation failed',
  data: ['email is required']
}

// Database error:
{
  success: false,
  message: 'Database operation failed',
  data: 'Record already exists'
}
```

## 📖 Complete Query Builder API Reference

### WHERE Methods

| Method | Syntax | SQL Output | Use Case |
|--------|--------|------------|----------|
| **Basic** |
| `where()` | `where('status', 'active')` | `WHERE status = ?` | Equality check |
| `where()` | `where('age', '>', 18)` | `WHERE age > ?` | Comparison |
| `orWhere()` | `orWhere('role', 'admin')` | `OR role = ?` | OR condition |
| **Negation** |
| `whereNot()` | `whereNot('status', 'banned')` | `WHERE status != ?` | Not equal |
| `orWhereNot()` | `orWhereNot('role', 'guest')` | `OR role != ?` | OR not equal |
| **Lists** |
| `whereIn()` | `whereIn('id', [1,2,3])` | `WHERE id IN (?,?,?)` | Match list |
| `whereNotIn()` | `whereNotIn('status', ['banned'])` | `WHERE status NOT IN (?)` | Exclude list |
| `orWhereIn()` | `orWhereIn('type', ['vip'])` | `OR type IN (?)` | OR match list |
| **NULL checks** |
| `whereNull()` | `whereNull('deleted_at')` | `WHERE deleted_at IS NULL` | Check NULL |
| `whereNotNull()` | `whereNotNull('email')` | `WHERE email IS NOT NULL` | Check NOT NULL |
| `orWhereNull()` | `orWhereNull('phone')` | `OR phone IS NULL` | OR NULL |
| `orWhereNotNull()` | `orWhereNotNull('address')` | `OR address IS NOT NULL` | OR NOT NULL |
| **Pattern Matching** |
| `whereLike()` | `whereLike('email', '%@gmail.com')` | `WHERE email LIKE ?` | Pattern match |
| `whereNotLike()` | `whereNotLike('name', 'Admin%')` | `WHERE name NOT LIKE ?` | Pattern exclude |
| `orWhereLike()` | `orWhereLike('name', 'John%')` | `OR name LIKE ?` | OR pattern |
| `orWhereNotLike()` | `orWhereNotLike('email', '%spam%')` | `OR email NOT LIKE ?` | OR exclude pattern |
| **Multi-Column** |
| `whereAny()` | `whereAny(['a','b'], 'val')` | `WHERE (a=? OR b=?)` | Match any column |
| `whereAll()` | `whereAll(['a','b'], 'val')` | `WHERE (a=? AND b=?)` | Match all columns |
| `whereNone()` | `whereNone(['a','b'], 'val')` | `WHERE (a!=? AND b!=?)` | Match no columns |

### JOIN Methods

| Method | Syntax | Example |
|--------|--------|---------|
| `innerJoin()` | `innerJoin(table, col1, col2)` | `innerJoin('posts', 'users.id', 'posts.user_id')` |
| `leftJoin()` | `leftJoin(table, col1, col2)` | `leftJoin('profiles', 'users.id', 'profiles.user_id')` |
| `rightJoin()` | `rightJoin(table, col1, col2)` | `rightJoin('orders', 'users.id', 'orders.user_id')` |
| `outerJoin()` | `outerJoin(table, col1, col2)` | Alias for `rightJoin()` |

**Features:**
- Supports qualified names: `'users.id'`, `'posts.user_id'`
- Custom operators: `innerJoin('posts', 'users.id', '!=', 'posts.deleted_by')`
- Chain multiple JOINs

### Ordering & Pagination

| Method | Syntax | Description |
|--------|--------|-------------|
| `orderBy()` | `orderBy('created_at', 'DESC')` | Sort results (ASC/DESC) |
| `limit()` | `limit(10)` | Limit number of results |
| `offset()` | `offset(20)` | Skip first N results |

### Execution Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get()` | `Promise<{success, message, data: []}>` | Execute and return all rows |
| `first()` | `Promise<{success, message, data: {}}>` | Execute and return first row |
| `count()` | `Promise<{success, message, data: number}>` | Count matching records |
| `sum(field)` | `Promise<{success, message, data: number}>` | Sum of column |
| `avg(field)` | `Promise<{success, message, data: number}>` | Average of column |
| `max(field)` | `Promise<{success, message, data: *}>` | Maximum value |
| `min(field)` | `Promise<{success, message, data: *}>` | Minimum value |
| `pluck(field)` | `Promise<{success, message, data: []}>` | Extract column values |

### Model Methods

| Method | Description | Example |
|--------|-------------|---------|
| `find(id)` | Find by primary key | `User.find('uuid-123')` |
| `findOrFail(id)` | Find or throw error | `User.findOrFail('uuid-123')` |
| `all()` | Get all records | `User.all()` |
| `first(conditions)` | Get first matching | `User.first({ status: 'active' })` |
| `create(data)` | Insert record | `User.create({ name: 'Alice' })` |
| `update(data)` | Update record | `User.update({ id: '123', name: 'Bob' })` |
| `delete(id)` | Delete by ID | `User.delete('uuid-123')` |

---

## 🎯 Real-World Query Examples

### E-commerce: Find High-Value Customers

```js
const User = model('users', userStruct);

// Find users with orders over $1000 in the last 30 days
const highValueCustomers = await User
  .innerJoin('orders', 'users.id', 'orders.user_id')
  .where('orders.created_at', '>', '2025-11-12 00:00:00')
  .where('orders.status', 'completed')
  .where('orders.total', '>', 1000)
  .get();

// Count VIP customers
const vipCount = await User
  .whereIn('membership_tier', ['gold', 'platinum'])
  .whereNotNull('last_purchase_at')
  .count();
```

### Social Media: Search Users

```js
// Search by name or email or username
const searchResults = await User
  .whereAny(['name', 'email', 'username'], searchTerm)
  .whereNot('status', 'banned')
  .orderBy('created_at', 'DESC')
  .limit(50)
  .get();

// Find Gmail/Yahoo users, exclude spam
const emailUsers = await User
  .whereLike('email', '%@gmail.com')
  .orWhereLike('email', '%@yahoo.com')
  .whereNotLike('email', '%+spam%')
  .get();
```

### Analytics: User Engagement Reports

```js
// Average posts per active user
const avgPosts = await User
  .innerJoin('posts', 'users.id', 'posts.user_id')
  .where('users.status', 'active')
  .avg('posts.id');

// Users with no posts (LEFT JOIN with NULL check)
const inactiveUsers = await User
  .leftJoin('posts', 'users.id', 'posts.user_id')
  .whereNull('posts.id')
  .get();

// Total revenue by user tier
const premiumRevenue = await User
  .innerJoin('orders', 'users.id', 'orders.user_id')
  .whereIn('users.tier', ['premium', 'enterprise'])
  .where('orders.status', 'completed')
  .sum('orders.total');
```

### Admin Dashboard: Filter & Export

```js
// Get user emails for newsletter (pluck)
const emails = await User
  .where('newsletter_subscribed', true)
  .whereNotNull('email')
  .pluck('email');
// emails.data = ['alice@example.com', 'bob@example.com', ...]

// Complex filtering for admin panel
const filteredUsers = await User
  .leftJoin('subscriptions', 'users.id', 'subscriptions.user_id')
  .where('users.created_at', '>', startDate)
  .whereIn('users.status', ['active', 'trial'])
  .whereNot('subscriptions.status', 'cancelled')
  .whereNull('users.deleted_at')
  .orderBy('users.created_at', 'DESC')
  .limit(100)
  .offset(page * 100)
  .get();
```

### Multi-Tenant: Tenant Isolation

```js
// Get all data for a specific tenant
const tenantUsers = await User
  .innerJoin('tenant_users', 'users.id', 'tenant_users.user_id')
  .where('tenant_users.tenant_id', tenantId)
  .where('users.status', 'active')
  .get();

// Ensure no data leaks across tenants
const tenantOrders = await model('orders', orderStruct)
  .innerJoin('users', 'orders.user_id', 'users.id')
  .innerJoin('tenant_users', 'users.id', 'tenant_users.user_id')
  .where('tenant_users.tenant_id', tenantId)
  .get();
```

### Data Validation: Find Inconsistencies

```js
// Find users with mismatched status fields
const inconsistent = await User
  .whereNone(['status', 'account_status', 'verification_status'], 'active')
  .get();

// Find orphaned records (no matching parent)
const orphanedPosts = await model('posts', postStruct)
  .leftJoin('users', 'posts.user_id', 'users.id')
  .whereNull('users.id')
  .get();
```

---

## 🔧 Migration Guide: v1.4.0 → v1.5.0

### Step 1: Verify Identifier Names
Ensure all your table and column names use only alphanumeric characters and underscores:

```javascript
// Check your table names
const validTables = ['users', 'user_profiles', 'orders_2024'];    // ✅ Valid
const invalidTables = ['user-profiles', 'users table', 'orders#']; // ❌ Invalid

// Check your column names in structs
const struct = [
  { name: "user_id", ... },       // ✅ Valid
  { name: "created_at", ... },    // ✅ Valid
  { name: "user-name", ... },     // ❌ Invalid - contains hyphen
];
```

### Step 2: Update Error Handling
Error messages are now more generic. If you're parsing error messages, update your code:

```javascript
// Before v1.5.0
if (result.data.includes('Duplicate entry')) { ... }

// After v1.5.0
if (result.data === 'Record already exists') { ... }
```

### Step 3: Review Validation Requirements
New validation is stricter. Ensure your payloads match the expected formats:

```javascript
// UUIDs must be valid v4 format
id: '123e4567-e89b-12d3-a456-426614174000'  // ✅

// Datetimes must be YYYY-MM-DD HH:MM:SS
created_at: '2025-04-07 10:00:00'  // ✅
created_at: '2025/04/07 10:00:00'  // ❌

// Dates must be YYYY-MM-DD
birth_date: '1990-05-15'  // ✅
birth_date: '05/15/1990'  // ❌

// Booleans must be proper type
is_active: true    // ✅
is_active: 1       // ✅
is_active: 'yes'   // ❌
```

### Step 4: Test Your Application
Run your test suite to catch any validation errors:

```bash
npm test
```

## ⚡ Why Choose vibeorm?

### vs. Writing Raw SQL
- ✅ **Type-safe** - Validate data before it hits the database
- ✅ **Secure by default** - SQL injection prevention built-in
- ✅ **Readable** - `User.where('status', 'active')` vs complex SQL strings
- ✅ **Maintainable** - Changes in one place, not scattered across files

### vs. Sequelize / TypeORM
- ✅ **Lightweight** - No bloat, just what you need
- ✅ **Fast setup** - Auto-generate structs from existing DB
- ✅ **Simple** - JSON structs, not complex decorators or configs
- ✅ **MySQL-optimized** - Built specifically for MySQL2

### vs. Eloquent (Laravel)
- ✅ **90% feature parity** - WHERE, JOINs, aggregates, pluck
- ✅ **Same ergonomics** - Chainable, intuitive API
- ✅ **Node.js native** - Built for modern JavaScript/TypeScript
- ✅ **Struct-based** - Your schema is just JSON

### Perfect For
- 🎯 **Startups** - Move fast with auto-generated structs
- 🎯 **APIs** - Build secure REST/GraphQL endpoints quickly
- 🎯 **Migrations from raw SQL** - Incremental adoption
- 🎯 **Developers who want Eloquent in Node.js**

---

## 📝 Changelog

### v1.6.0 (2025-12-12)
**New Features**
- ✨ Added **Model API** - Eloquent-like interface for cleaner code
- ✨ Added **QueryBuilder** with chainable methods
- ✨ Support for complex WHERE clauses:
  - `where()`, `orWhere()`, `whereNot()`, `orWhereNot()`
  - `whereIn()`, `whereNotIn()`, `orWhereIn()`
  - `whereNull()`, `whereNotNull()`, `orWhereNull()`, `orWhereNotNull()`
  - `whereLike()`, `whereNotLike()`, `orWhereLike()`, `orWhereNotLike()`
  - `whereAny()`, `whereAll()`, `whereNone()` - multi-column checks
- ✨ JOIN support:
  - `innerJoin()`, `leftJoin()`, `rightJoin()`, `outerJoin()`
  - Support for qualified column names and custom operators
- ✨ Comparison operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`
- ✨ Aggregate functions (`count()`, `sum()`, `avg()`, `max()`, `min()`)
- ✨ Advanced ordering and pagination
- ✨ `pluck()` method for extracting single column values

**Backward Compatibility**
- ✅ All existing function-based APIs remain unchanged
- ✅ No breaking changes - opt-in to new Model API

### v1.5.0 (2025-12-11)
**Security Enhancements**
- ✅ Added SQL injection prevention with hybrid validation & escaping
- ✅ Enhanced input validation (UUID, datetime, date, boolean formats)
- ✅ Implemented error message sanitization
- ✅ Added comprehensive security test suite

**Breaking Changes**
- ⚠️ Table/column names now restricted to `[a-zA-Z0-9_]`
- ⚠️ Error messages are now sanitized (more generic)
- ⚠️ Stricter type validation for UUID, datetime, date, boolean fields

**New Features**
- Server-side error logging with `console.error()`
- Improved validation error messages
- Better handling of null/undefined in non-required enum fields

## 🌐 TechnoSorcery.com

Built with ✨ by [TechnoSorcery.com](https://technosorcery.com)