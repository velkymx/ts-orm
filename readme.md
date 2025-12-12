# 🧙‍♂️ ts-orm – TechnoSorcery ORM

A lightweight, JSON-struct-based ORM for Node.js using MySQL2. Define your schema in JSON, validate payloads, and perform CRUD operations with ease — no magic required 🪄.

---

## 🚀 Features

- ✅ Define data schemas using simple JSON structs
- ✅ Validates payloads before writing to DB
- ✅ **SQL injection prevention** with identifier validation & escaping
- ✅ **Enhanced input validation** (UUID, datetime, date, boolean formats)
- ✅ **Sanitized error messages** for security
- ✅ Supports full CRUD (Create, Read, Update, Delete)
- ✅ Consistent JSON responses
- ✅ Built on MySQL2 + dotenv
- ✅ ESM-ready (ES6+ syntax)

---

## 🔒 Security (v1.5.0+)

**ts-orm** now includes enterprise-grade security features:

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

## Installation

```bash
npm i @velkymx/ts-orm
```

## Usage Examples

```js
import { create, read, update, delete } from 'ts-orm';

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

## Handling Create Success or Failure with ts-orm

Using the above defined `userStruct`, you can use `ts-orm` to attempt to create a record and handle the result accordingly.

### Example

```js
import { create } from 'ts-orm';

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

## Using ts-orm in an ExpressJS Controller

Here's how you can integrate `ts-orm` into an Express route handler to create a record and return a proper JSON API response.

### Example

```js
import express from 'express';
import { create } from 'ts-orm';
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


## Using the CLI Tool to Generate Structs

If you need to quickly create `ts-orm` structs from your MySQL database, here's a command-line tool that allows you to automagically introspect a table and output a JSON struct definition.

### Generate a struct from a table

```bash
npx ts-orm struct users
```

This will connect to your database using your `.env` config and generate a file named:

```
users.json
```

You can then use this file as the struct definition for `ts-orm` CRUD operations.

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

## 📝 Changelog

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