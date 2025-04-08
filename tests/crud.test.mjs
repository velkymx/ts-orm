import {
  create,
  read,
  readOne,
  readWith,
  findOrFail,
  update,
  remove
} from '../src/orm.js';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();

const table = 'test';
const relatedTable = 'related';

const struct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "name", type: "string", required: true, length: 128, default: "" },
  { name: "json", type: "string", required: true, length: 0, default: "" },
  { name: "related_forms", type: "string", required: true, length: 1024, default: "" },
  { name: "icon", type: "string", required: false, length: 128, default: "folder-close" },
  { name: "date_created", type: "datetime", required: true, length: 19, default: "current_timestamp" },
  { name: "date_updated", type: "datetime", required: false, length: null, default: null },
  { name: "date_due", type: "date", required: false, length: null, default: null },
  { name: "commission_type", type: "enum", required: false, length: 24, default: "percent", enum: ["percent", "flat"] },
  { name: "opt_shareclient", type: "boolean", required: false, length: 1, default: false }
];

const relatedStruct = [
  { name: "id", type: "uuid", required: true, length: 36, default: "" },
  { name: "ref_id", type: "uuid", required: true, length: 36, default: "" },
  { name: "label", type: "string", required: false, length: 128, default: "" }
];

async function getConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
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
      json TEXT NOT NULL,
      related_forms VARCHAR(1024) NOT NULL,
      icon VARCHAR(128),
      date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      date_updated DATETIME,
      date_due DATE,
      commission_type ENUM('percent', 'flat') DEFAULT 'percent',
      opt_shareclient BOOLEAN DEFAULT FALSE
    )
  `;

  const relatedTableSQL = `
    CREATE TABLE IF NOT EXISTS ${relatedTable} (
      id VARCHAR(36) PRIMARY KEY,
      ref_id VARCHAR(36) NOT NULL,
      label VARCHAR(128)
    )
  `;

  await conn.execute(testTableSQL);
  await conn.execute(relatedTableSQL);
  await conn.end();
}

async function dropTestTable() {
  const conn = await getConnection();
  await conn.execute(`DROP TABLE IF EXISTS ${relatedTable}`);
  await conn.execute(`DROP TABLE IF EXISTS ${table}`);
  await conn.end();
}

describe('ts-orm CRUD operations', () => {
  const testId = uuidv4();
  const relatedId = uuidv4();

  const basePayload = {
    id: testId,
    name: "Test Record",
    json: JSON.stringify({ key: "value" }),
    related_forms: "form1,form2",
    icon: "test-icon",
    date_created: new Date().toISOString().slice(0, 19).replace('T', ' '),
    commission_type: "percent",
    opt_shareclient: true
  };

  beforeAll(async () => {
    await createTestTable();
  });

  afterAll(async () => {
    await dropTestTable();
  });

  test('Create a record', async () => {
    const res = await create(table, struct, basePayload);
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('id');
  });

  test('Read the record', async () => {
    const res = await read(table, { id: testId });
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(1);
    expect(res.data[0].name).toBe("Test Record");
  });

  test('Read one record', async () => {
    const res = await readOne(table, { id: testId });
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('id');
    expect(res.data.id).toBe(testId);
  });

  test('Find or fail - success', async () => {
    const record = await findOrFail(table, 'id', testId);
    expect(record).toBeDefined();
    expect(record.id).toBe(testId);
  });

  test('Insert related record for join', async () => {
    const res = await create(relatedTable, relatedStruct, {
      id: relatedId,
      ref_id: testId,
      label: "Joined Label"
    });
    expect(res.success).toBe(true);
  });

  test('Read with join', async () => {
    const res = await readWith(relatedTable, { ref_id: testId }, [
      { table: table, on: [`${relatedTable}.ref_id`, `${table}.id`], type: 'inner' }
    ]);
    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0].label).toBe("Joined Label");
  });

  test('Update the record', async () => {
    const updatedPayload = {
      ...basePayload,
      name: "Updated Record",
      date_updated: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };

    const res = await update(table, struct, updatedPayload);
    expect(res.success).toBe(true);
    expect(res.data.affectedRows).toBe(1);
  });

  test('Verify updated data', async () => {
    const res = await read(table, { id: testId });
    expect(res.success).toBe(true);
    expect(res.data[0].name).toBe("Updated Record");
  });

  test('Delete the record', async () => {
    const res = await remove(table, 'id', testId);
    expect(res.success).toBe(true);
    expect(res.data.affectedRows).toBe(1);
  });

  test('Confirm deletion', async () => {
    const res = await read(table, { id: testId });
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(0);
  });

  test('Find or fail - throws error', async () => {
    await expect(findOrFail(table, 'id', 'non-existent-id')).rejects.toThrow('Record not found');
  });
});
