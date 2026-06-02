import { QueryBuilder } from '../src/QueryBuilder.js';
import { model } from '../src/model.js';
import { generateStructFromTable } from '../src/introspect.js';
import { isValidDate, isValidDatetime, isValidBoolean, isValidUUID } from '../src/security.js';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

// Dedicated schema so JOIN builders and multi-column WHERE variants can be
// exercised against real MySQL (the model suite has only one table).
const usersTable = 'b_users';
const ordersTable = 'b_orders';

const usersStruct = [
  { name: 'id', type: 'number', required: false, length: null, default: 'auto_increment' },
  { name: 'name', type: 'string', required: true, length: 64, default: '' },
  { name: 'email', type: 'string', required: true, length: 128, default: '' },
  { name: 'city', type: 'string', required: false, length: 64, default: null },
  { name: 'age', type: 'number', required: false, length: null, default: null },
  { name: 'nickname', type: 'string', required: false, length: 64, default: null }
];

function qb(table) {
  return new QueryBuilder(table, usersStruct);
}

async function getConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
}

beforeAll(async () => {
  const conn = await getConnection();
  await conn.execute(`DROP TABLE IF EXISTS ${ordersTable}`);
  await conn.execute(`DROP TABLE IF EXISTS ${usersTable}`);
  await conn.execute(`
    CREATE TABLE ${usersTable} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      email VARCHAR(128) NOT NULL,
      city VARCHAR(64),
      age INT,
      nickname VARCHAR(64)
    )
  `);
  await conn.execute(`
    CREATE TABLE ${ordersTable} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      total DECIMAL(10,2) NOT NULL
    )
  `);

  // id 1 Alice / 2 Bob / 3 Carol / 4 Dave
  await conn.execute(
    `INSERT INTO ${usersTable} (name, email, city, age, nickname) VALUES
      ('Alice', 'alice@x.com', 'NYC', 30, NULL),
      ('Bob',   'bob@x.com',   'LA',  25, 'bobby'),
      ('Carol', 'carol@x.com', 'NYC', 40, NULL),
      ('Dave',  'dave@x.com',  'SF',  35, 'davey')`
  );
  // Alice has 2 orders, Bob 1, Carol/Dave none
  await conn.execute(
    `INSERT INTO ${ordersTable} (user_id, total) VALUES (1, 100.50), (1, 200.00), (2, 50.00)`
  );
  await conn.end();
});

afterAll(async () => {
  const conn = await getConnection();
  await conn.execute(`DROP TABLE IF EXISTS ${ordersTable}`);
  await conn.execute(`DROP TABLE IF EXISTS ${usersTable}`);
  await conn.end();
});

describe('QueryBuilder - WHERE variants', () => {
  test('whereNot excludes matching rows', async () => {
    const res = await qb(usersTable).whereNot('city', 'NYC').get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(2);
    expect(res.data.every(r => r.city !== 'NYC')).toBe(true);
  });

  test('whereLike matches a pattern', async () => {
    const res = await qb(usersTable).whereLike('name', 'A%').get();
    expect(res.success).toBe(true);
    expect(res.data.map(r => r.name)).toEqual(['Alice']);
  });

  test('orWhereLike unions an additional pattern', async () => {
    const res = await qb(usersTable).where('city', 'LA').orWhereLike('name', 'C%').get();
    expect(res.success).toBe(true);
    expect(res.data.map(r => r.name).sort()).toEqual(['Bob', 'Carol']);
  });

  test('whereNotLike negates a pattern', async () => {
    const res = await qb(usersTable).whereNotLike('name', 'A%').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => !r.name.startsWith('A'))).toBe(true);
    expect(res.data.length).toBe(3);
  });

  test('orWhereNotLike unions a negated pattern', async () => {
    const res = await qb(usersTable).where('city', 'NYC').orWhereNotLike('email', 'a%').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => r.city === 'NYC' || !r.email.startsWith('a'))).toBe(true);
  });

  test('orWhereNot unions a not-equal condition', async () => {
    const res = await qb(usersTable).where('city', 'NYC').orWhereNot('city', 'LA').get();
    expect(res.success).toBe(true);
    // NYC OR (city != LA) -> every LA-only row excluded
    expect(res.data.every(r => r.city !== 'LA')).toBe(true);
  });

  test('whereAny matches when any listed column equals the value', async () => {
    const res = await qb(usersTable).whereAny(['name', 'city'], 'NYC').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => r.city === 'NYC')).toBe(true);
    expect(res.data.length).toBe(2);
  });

  test('whereAll requires every listed column to equal the value', async () => {
    const res = await qb(usersTable).whereAll(['name', 'city'], 'NYC').get();
    expect(res.success).toBe(true);
    // name='NYC' AND city='NYC' -> impossible in this data
    expect(res.data.length).toBe(0);
  });

  test('whereNone excludes rows where any listed column equals the value', async () => {
    const res = await qb(usersTable).whereNone(['city'], 'NYC').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => r.city !== 'NYC')).toBe(true);
  });

  test('orWhereIn unions an IN set', async () => {
    const res = await qb(usersTable).where('city', 'SF').orWhereIn('age', [25]).get();
    expect(res.success).toBe(true);
    expect(res.data.map(r => r.name).sort()).toEqual(['Bob', 'Dave']);
  });

  test('orWhereNull unions an IS NULL condition', async () => {
    const res = await qb(usersTable).where('city', 'NYC').orWhereNull('nickname').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => r.city === 'NYC' || r.nickname === null)).toBe(true);
  });

  test('orWhereNotNull unions an IS NOT NULL condition', async () => {
    const res = await qb(usersTable).where('city', 'SF').orWhereNotNull('nickname').get();
    expect(res.success).toBe(true);
    expect(res.data.every(r => r.city === 'SF' || r.nickname !== null)).toBe(true);
  });

  test('whereIn with an empty array matches nothing (no IN () syntax error)', async () => {
    const res = await qb(usersTable).whereIn('city', []).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(0);
  });

  test('whereNotIn with an empty array matches everything', async () => {
    const res = await qb(usersTable).whereNotIn('city', []).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(4);
  });
});

describe('QueryBuilder - JOIN builders', () => {
  test('innerJoin returns only matching rows', async () => {
    const res = await qb(ordersTable).innerJoin(usersTable, `${ordersTable}.user_id`, `${usersTable}.id`).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(3); // 3 orders, all owned
    expect(res.data[0].name).toBeDefined();
  });

  test('leftJoin keeps all left rows', async () => {
    const res = await qb(usersTable).leftJoin(ordersTable, `${usersTable}.id`, `${ordersTable}.user_id`).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(5); // Alice x2 + Bob x1 + Carol(null) + Dave(null)
  });

  test('rightJoin keeps all right rows', async () => {
    const res = await qb(ordersTable).rightJoin(usersTable, `${ordersTable}.user_id`, `${usersTable}.id`).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(5);
  });

  test('outerJoin aliases rightJoin', async () => {
    const res = await qb(ordersTable).outerJoin(usersTable, `${ordersTable}.user_id`, `${usersTable}.id`).get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(5);
  });

  test('innerJoin rejects an injected join table (escaping enforced)', async () => {
    const res = await qb(ordersTable).innerJoin('bad; DROP TABLE b_users--', `${ordersTable}.user_id`, `${usersTable}.id`).get();
    expect(res.success).toBe(false);
    expect(res.data).toContain('Invalid');
  });

  test('leftJoin rejects an injected qualified column', async () => {
    const res = await qb(usersTable).leftJoin(ordersTable, `${usersTable}.id`, 'b_orders.user_id; DROP--').get();
    expect(res.success).toBe(false);
    expect(res.data).toContain('Invalid');
  });
});

describe('QueryBuilder - pluck and clone', () => {
  test('pluck returns a single column as an array', async () => {
    const res = await qb(usersTable).orderBy('age', 'ASC').pluck('name');
    expect(res.success).toBe(true);
    expect(res.data).toEqual(['Bob', 'Alice', 'Dave', 'Carol']);
  });

  test('pluck honors a where condition', async () => {
    const res = await qb(usersTable).where('city', 'NYC').pluck('name');
    expect(res.success).toBe(true);
    expect(res.data.sort()).toEqual(['Alice', 'Carol']);
  });

  test('clone returns a fresh, independent builder', async () => {
    const original = qb(usersTable).where('city', 'NYC');
    const cloned = original.clone();
    expect(cloned).toBeInstanceOf(QueryBuilder);
    expect(cloned).not.toBe(original);
    // clone starts clean: no inherited WHERE -> all rows
    const res = await cloned.get();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(4);
  });
});

describe('Model - pluck, deleteWhere, readWith', () => {
  const Users = model(usersTable, usersStruct);

  test('model.pluck with conditions', async () => {
    const res = await Users.pluck('name', { city: 'NYC' });
    expect(res.success).toBe(true);
    expect(res.data.sort()).toEqual(['Alice', 'Carol']);
  });

  test('model.readWith joins related rows', async () => {
    const res = await Users.readWith({}, [
      { table: ordersTable, on: [`${usersTable}.id`, `${ordersTable}.user_id`], type: 'left' }
    ]);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBe(5);
  });

  test('model.deleteWhere removes matching rows', async () => {
    const Temp = model(usersTable, usersStruct);
    await Temp.create({ name: 'Temp', email: 'temp@x.com', city: 'TEMP' });
    const before = await qb(usersTable).where('city', 'TEMP').count();
    expect(before.data).toBe(1);

    const del = await Users.deleteWhere('city', 'TEMP');
    expect(del.success).toBe(true);

    const after = await qb(usersTable).where('city', 'TEMP').count();
    expect(after.data).toBe(0);
  });
});

describe('introspect.generateStructFromTable', () => {
  test('generates a struct for an existing table', async () => {
    const struct = await generateStructFromTable(usersTable);
    expect(Array.isArray(struct)).toBe(true);
    expect(struct.find(f => f.name === 'name')?.type).toBe('string');
    expect(struct.find(f => f.name === 'id')?.default).toBe('auto_increment');
  });

  test('throws a sanitized error for a missing table (no raw DB detail)', async () => {
    await expect(generateStructFromTable('definitely_not_a_table_xyz')).rejects.toThrow('Table not found');
  });

  test('parses enum values cleanly (no stray whitespace)', async () => {
    const c = await getConnection();
    await c.execute('DROP TABLE IF EXISTS b_enum');
    // Intentionally spaced enum definition — verify the parsed values are trimmed.
    await c.execute("CREATE TABLE b_enum (id INT PRIMARY KEY, kind ENUM('a', 'b', 'c'))");
    await c.end();

    const struct = await generateStructFromTable('b_enum');
    const kind = struct.find(f => f.name === 'kind');
    expect(kind.enum).toEqual(['a', 'b', 'c']);

    const c2 = await getConnection();
    await c2.execute('DROP TABLE IF EXISTS b_enum');
    await c2.end();
  });
});

describe('Validator/security edge cases', () => {
  test('isValidDate rejects out-of-range and invalid dates', () => {
    expect(isValidDate('2025-06-15')).toBe(true);
    expect(isValidDate('2025-13-01')).toBe(false); // month
    expect(isValidDate('2025-02-30')).toBe(false); // impossible day
    expect(isValidDate('2025/06/15')).toBe(false); // format
    expect(isValidDate(20250615)).toBe(false);     // non-string
  });

  test('isValidDatetime enforces ranges', () => {
    expect(isValidDatetime('2025-06-15 12:30:45')).toBe(true);
    expect(isValidDatetime('2025-06-15 25:00:00')).toBe(false); // hour
    expect(isValidDatetime('2025-06-15 12:60:00')).toBe(false); // minute
    expect(isValidDatetime('2025-13-15 12:00:00')).toBe(false); // month
    expect(isValidDatetime('not-a-datetime')).toBe(false);
  });

  test('isValidBoolean accepts bool/0/1 forms only', () => {
    expect(isValidBoolean(true)).toBe(true);
    expect(isValidBoolean(0)).toBe(true);
    expect(isValidBoolean('1')).toBe(true);
    expect(isValidBoolean(2)).toBe(false);
    expect(isValidBoolean('yes')).toBe(false);
  });

  test('isValidUUID validates v4 format', () => {
    expect(isValidUUID(randomUUID())).toBe(true);
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID(123)).toBe(false);
  });
});
