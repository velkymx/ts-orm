import { model } from '../src/model.js';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const table = 'model_test';

const struct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "name", type: "string", required: true, length: 128, default: "" },
  { name: "email", type: "string", required: true, length: 256, default: "" },
  { name: "status", type: "enum", required: true, length: null, default: "pending", enum: ["active", "pending", "inactive"] },
  { name: "age", type: "number", required: false, length: null, default: null },
  { name: "balance", type: "number", required: false, length: null, default: 0 },
  { name: "date_created", type: "datetime", required: true, length: 19, default: "current_timestamp" },
  { name: "last_login", type: "datetime", required: false, length: null, default: null }
];

// Create model instance
const User = model(table, struct);

async function getConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
}

async function createTestTable() {
  const conn = await getConnection();

  const testTableSQL = `
    CREATE TABLE IF NOT EXISTS ${table} (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      email VARCHAR(256) NOT NULL,
      status ENUM('active', 'pending', 'inactive') DEFAULT 'pending',
      age INT,
      balance DECIMAL(10, 2) DEFAULT 0,
      date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `;

  await conn.execute(testTableSQL);
  await conn.end();
}

async function dropTestTable() {
  const conn = await getConnection();
  await conn.execute(`DROP TABLE IF EXISTS ${table}`);
  await conn.end();
}

describe('Model API Tests', () => {
  const testUsers = [];

  beforeAll(async () => {
    await createTestTable();

    // Create test data
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      testUsers.push({
        id,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'pending' : 'inactive',
        age: 20 + i,
        balance: 100 * (i + 1),
        date_created: new Date().toISOString().slice(0, 19).replace('T', ' ')
      });

      await User.create(testUsers[i]);
    }
  });

  afterAll(async () => {
    await dropTestTable();
  });

  describe('Basic Model Methods', () => {
    test('find() - retrieve record by ID', async () => {
      const result = await User.find(testUsers[0].id);
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('User 0');
    });

    test('findOrFail() - returns the standard envelope on success', async () => {
      const res = await User.findOrFail(testUsers[0].id);
      expect(res.success).toBe(true);
      expect(res.data.id).toBe(testUsers[0].id);
    });

    test('findOrFail() - missing record returns a failure envelope (no throw)', async () => {
      const res = await User.findOrFail('non-existent');
      expect(res.success).toBe(false);
      expect(res.message).toBe('Record not found');
      expect(res.data).toBeNull();
    });

    test('all() - get all records', async () => {
      const result = await User.all();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(10);
    });

    test('first() - get first record with condition', async () => {
      const result = await User.first({ status: 'active' });
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('active');
    });

    test('create() - insert new record', async () => {
      const newUser = {
        id: randomUUID(),
        name: 'New User',
        email: 'new@example.com',
        status: 'active',
        age: 25,
        date_created: new Date().toISOString().slice(0, 19).replace('T', ' ')
      };

      const result = await User.create(newUser);
      expect(result.success).toBe(true);
    });

    test('update() - modify existing record', async () => {
      const result = await User.update({
        id: testUsers[0].id,
        name: 'Updated User 0'
      });
      expect(result.success).toBe(true);

      const updated = await User.find(testUsers[0].id);
      expect(updated.data.name).toBe('Updated User 0');
    });

    test('delete() - remove record', async () => {
      const tempId = randomUUID();
      await User.create({
        id: tempId,
        name: 'Temp User',
        email: 'temp@example.com',
        date_created: new Date().toISOString().slice(0, 19).replace('T', ' ')
      });

      const result = await User.delete(tempId);
      expect(result.success).toBe(true);

      const notFound = await User.find(tempId);
      expect(notFound.success).toBe(false);
    });
  });

  describe('Query Builder - WHERE Clauses', () => {
    test('where() - simple equality', async () => {
      const result = await User.where('status', 'active').get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => u.status === 'active')).toBe(true);
    });

    test('where() - with operator', async () => {
      const result = await User.where('age', '>', 25).get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => u.age > 25)).toBe(true);
    });

    test('where() - multiple conditions (object)', async () => {
      const result = await User.where({ status: 'active' }).get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => u.status === 'active')).toBe(true);
    });

    test('where() - chained conditions', async () => {
      const result = await User
        .where('status', 'active')
        .where('age', '>', 20)
        .get();

      expect(result.success).toBe(true);
      expect(result.data.every(u => u.status === 'active' && u.age > 20)).toBe(true);
    });

    test('orWhere() - OR condition', async () => {
      const result = await User
        .where('status', 'active')
        .orWhere('status', 'pending')
        .get();

      expect(result.success).toBe(true);
      expect(result.data.every(u => u.status === 'active' || u.status === 'pending')).toBe(true);
    });

    test('whereIn() - IN clause', async () => {
      const result = await User.whereIn('status', ['active', 'pending']).get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => ['active', 'pending'].includes(u.status))).toBe(true);
    });

    test('whereNotIn() - NOT IN clause', async () => {
      const result = await User
        .query()
        .whereNotIn('status', ['inactive'])
        .get();

      expect(result.success).toBe(true);
      expect(result.data.every(u => u.status !== 'inactive')).toBe(true);
    });

    test('whereNull() - IS NULL', async () => {
      const result = await User.whereNull('last_login').get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => u.last_login === null)).toBe(true);
    });

    test('whereNotNull() - IS NOT NULL', async () => {
      const result = await User.whereNotNull('age').get();
      expect(result.success).toBe(true);
      expect(result.data.every(u => u.age !== null)).toBe(true);
    });
  });

  describe('Query Builder - Ordering and Limits', () => {
    test('orderBy() - ascending', async () => {
      const result = await User.orderBy('age', 'ASC').get();
      expect(result.success).toBe(true);
      expect(result.data[0].age).toBeLessThanOrEqual(result.data[1].age);
    });

    test('orderBy() - descending', async () => {
      const result = await User.orderBy('age', 'DESC').get();
      expect(result.success).toBe(true);
      expect(result.data[0].age).toBeGreaterThanOrEqual(result.data[1].age);
    });

    test('limit() - restrict results', async () => {
      const result = await User.limit(5).get();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(5);
    });

    test('offset() - skip records', async () => {
      const result = await User.orderBy('age', 'ASC').offset(5).get();
      expect(result.success).toBe(true);
      expect(result.data[0].age).toBeGreaterThan(24);
    });

    test('limit() + offset() - pagination', async () => {
      const result = await User
        .orderBy('age', 'ASC')
        .limit(3)
        .offset(2)
        .get();

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(3);
    });
  });

  describe('Query Builder - Complex Queries', () => {
    test('Complex query with multiple clauses', async () => {
      const result = await User
        .whereIn('status', ['active', 'pending'])
        .where('age', '>=', 22)
        .orderBy('age', 'DESC')
        .limit(5)
        .get();

      expect(result.success).toBe(true);
      expect(result.data.every(u => ['active', 'pending'].includes(u.status))).toBe(true);
      expect(result.data.every(u => u.age >= 22)).toBe(true);
      expect(result.data.length).toBeLessThanOrEqual(5);
    });

    test('first() - get single result from query', async () => {
      const result = await User
        .where('status', 'active')
        .orderBy('age', 'ASC')
        .first();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data.status).toBe('active');
    });
  });

  describe('Query Builder - Aggregates', () => {
    test('count() - count all records', async () => {
      const result = await User.count();
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThanOrEqual(10);
    });

    test('count() - count with conditions', async () => {
      const result = await User.where('status', 'active').count();
      expect(result.success).toBe(true);
      expect(typeof result.data).toBe('number');
    });

    test('sum() - sum column values', async () => {
      const result = await User.sum('balance');
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThan(0);
    });

    test('avg() - average column values', async () => {
      const result = await User.avg('age');
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThan(0);
    });

    test('max() - maximum value', async () => {
      const result = await User.max('age');
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThanOrEqual(20);
    });

    test('min() - minimum value', async () => {
      const result = await User.min('age');
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThanOrEqual(20);
    });

    test('sum() - with where condition', async () => {
      const result = await User
        .where('status', 'active')
        .sum('balance');

      expect(result.success).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    test('Model exposes table and struct properties', () => {
      expect(User.table).toBe(table);
      expect(User.struct).toEqual(struct);
    });

    test('query() returns fresh QueryBuilder', () => {
      const qb1 = User.query();
      const qb2 = User.query();
      expect(qb1).not.toBe(qb2); // Different instances
    });
  });
});

describe('Security - operator allowlist (S1)', () => {
  // The comparison operator sits in a non-parameterizable SQL position, so a
  // caller-supplied operator string must be rejected up front. These prove the
  // injection vector is closed and that legitimate operators still pass.

  test('where() throws on a non-whitelisted operator (blocks injection)', () => {
    expect(() => User.where('age', '0 OR 1=1 OR age <', 5)).toThrow(/Invalid operator/);
  });

  test('query().where() throws on an injected operator', () => {
    expect(() => User.query().where('age', 'OR 1=1 --', 5)).toThrow(/Invalid operator/);
  });

  test('orWhere() throws on a non-whitelisted operator', () => {
    expect(() => User.query().where('age', '>', 1).orWhere('age', 'OR 1=1', 2))
      .toThrow(/Invalid operator/);
  });

  test('innerJoin() throws on a non-whitelisted operator', () => {
    expect(() => User.query().innerJoin('model_test', 'model_test.id', 'OR 1=1', 'model_test.id'))
      .toThrow(/Invalid operator/);
  });

  test('legitimate operators are still accepted', () => {
    expect(() => User.where('age', '>=', 1)).not.toThrow();
    expect(() => User.where('status', 'active')).not.toThrow();
    expect(() => User.query().where('name', 'LIKE', '%a%')).not.toThrow();
  });
});
