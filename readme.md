# 🧙‍♂️ ts-orm – TechnoSorcery ORM

A lightweight, JSON-struct-based ORM for Node.js using MySQL2. Define your schema in JSON, validate payloads, and perform CRUD operations with ease — no magic required 🪄.

---

## 🚀 Features

- ✅ Define data schemas using simple JSON structs
- ✅ Validates payloads before writing to DB
- ✅ Supports full CRUD (Create, Read, Update, Delete)
- ✅ Consistent JSON responses
- ✅ Built on MySQL2 + dotenv
- ✅ ESM-ready (ES6+ syntax)

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
### Output on Fail
* Failed to create user:
* Message: Validation failed
* Details: [ 'email is required' ]

### Output on Success
User created successfully: { id: 1 }

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

| Type         | Description                          | Example Value                          | Notes                                              |
|--------------|--------------------------------------|----------------------------------------|----------------------------------------------------|
| `uuid`       | Universally unique identifier        | `"123e4567-e89b-12d3-a456-426614174000"` | Must match UUID v4 format                          |
| `string`     | Text string                          | `"Alice"`                               | `length` defines max characters allowed            |
| `number`     | Integer or float                     | `42`                                     | Used for numeric fields including IDs              |
| `datetime`   | Date and time                        | `"2025-04-07 10:00:00"`                 | Format: `YYYY-MM-DD HH:MM:SS`                      |
| `date`       | Date only                            | `"2025-04-07"`                          | Format: `YYYY-MM-DD`                               |
| `boolean`    | Boolean flag                         | `true` or `false`                       | Stored as TINYINT in MySQL                         |
| `enum`       | Predefined set of valid strings      | `"percent"` or `"flat"`                | Must define `enum: [...]` in struct                |
| `auto_increment` | Special case for `number` fields   | Not passed on insert                    | Use `"default": "auto_increment"` in struct config |


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

## 🌐 TechnoSorcery.com

Built with ✨ by [TechnoSorcery.com](https://technosorcery.com)