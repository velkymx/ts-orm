import {
  create,
  read,
  readOne,
  readWith,
  findOrFail,
  update,
  remove
} from '../src/orm.js';
import { validatePayload } from '../src/validator.js';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();

const table = 'test';
const relatedTable = 'related';

const autoTable = 'autotest';

const autoStruct = [
  {
    name: 'id',
    type: 'number',
    required: true,
    length: 11,
    default: 'auto_increment'
  },
  {
    name: 'title',
    type: 'string',
    required: true,
    length: 128,
    default: ''
  }
];

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

  const autoTableSQL = `
  CREATE TABLE IF NOT EXISTS ${autoTable} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(128) NOT NULL
  )
`;
  await conn.execute(autoTableSQL);
  await conn.execute(testTableSQL);
  await conn.execute(relatedTableSQL);
  await conn.end();
}

async function dropTestTable() {
  const conn = await getConnection();
  await conn.execute(`DROP TABLE IF EXISTS ${relatedTable}`);
  await conn.execute(`DROP TABLE IF EXISTS ${table}`);
  await conn.execute(`DROP TABLE IF EXISTS ${autoTable}`);
  await conn.end();
}

describe('Security Tests', () => {
  test('Rejects SQL injection in table name', async () => {
    const maliciousTable = "users; DROP TABLE users--";
    const res = await read(maliciousTable, {});
    expect(res.success).toBe(false);
    expect(res.message).toBe('Database operation failed');
    expect(res.data).toContain('Invalid');
  });

  test('Rejects SQL injection in ORDER BY', async () => {
    const res = await read(table, {}, { orderBy: "id; DROP TABLE test--" });
    expect(res.success).toBe(false);
    expect(res.message).toBe('Database operation failed');
    expect(res.data).toContain('Invalid');
  });

  test('Rejects SQL injection in WHERE column names', async () => {
    const res = await read(table, { "id' OR '1'='1": 'test' });
    expect(res.success).toBe(false);
    expect(res.message).toBe('Database operation failed');
    expect(res.data).toContain('Invalid');
  });

  test('Rejects SQL injection in JOIN table name', async () => {
    const res = await readWith(table, {}, [
      { table: "test'; DROP TABLE test--", on: ['test.id', 'test.id'], type: 'inner' }
    ]);
    expect(res.success).toBe(false);
    expect(res.message).toBe('Database operation failed');
    expect(res.data).toContain('Invalid');
  });

  test('Validates UUID format', async () => {
    const res = await create(table, struct, {
      ...basePayload,
      id: 'not-a-uuid',
      name: 'Test',
      json: '{}',
      related_forms: 'test',
      date_created: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe('Validation failed');
    expect(res.data).toContain('id must be a valid UUID');
  });

  test('Validates datetime format', async () => {
    const res = await create(table, struct, {
      ...basePayload,
      id: uuidv4(),
      date_created: 'invalid-date'
    });
    expect(res.success).toBe(false);
    expect(res.data).toContain('date_created must be in format YYYY-MM-DD HH:MM:SS');
  });

  test('Validates date format', async () => {
    const testPayload = {
      ...basePayload,
      id: uuidv4(),
      date_due: '2025/04/07' // Wrong format
    };
    const res = await create(table, struct, testPayload);
    expect(res.success).toBe(false);
    expect(res.data).toContain('date_due must be in format YYYY-MM-DD');
  });

  test('Validates boolean type', async () => {
    const testPayload = {
      ...basePayload,
      id: uuidv4(),
      opt_shareclient: 'not-a-boolean'
    };
    const res = await create(table, struct, testPayload);
    expect(res.success).toBe(false);
    expect(res.data).toContain('opt_shareclient must be a boolean');
  });

  test('Rejects empty/whitespace string for a number field', () => {
    // Number('') and Number(' ') are 0, so a blank string must not slip through
    // numeric validation.
    const numStruct = [{ name: 'age', type: 'number', required: true, length: null, default: null }];
    expect(validatePayload(numStruct, { age: '' })).toContain('age must be a number');
    expect(validatePayload(numStruct, { age: '   ' })).toContain('age must be a number');
    expect(validatePayload(numStruct, { age: 'abc' })).toContain('age must be a number');
    // Genuine numbers (and numeric strings) still pass.
    expect(validatePayload(numStruct, { age: 42 })).toEqual([]);
    expect(validatePayload(numStruct, { age: '42' })).toEqual([]);
  });

  test('Rejects update with no updatable fields (avoids invalid SET SQL)', async () => {
    // Only the id key is supplied, so there is nothing to SET. Must fail cleanly
    // rather than emitting `UPDATE ... SET  WHERE id = ?` (a SQL parse error).
    const res = await update(table, struct, { id: uuidv4() });
    expect(res.success).toBe(false);
    expect(res.message).toBe('No fields to update');
  });

  test('Allows null for non-required enum field', async () => {
    const testPayload = {
      ...basePayload,
      id: uuidv4(),
      commission_type: null,
      opt_shareclient: false
    };
    const res = await create(table, struct, testPayload);
    // This will fail without DB connection, but validates the validation logic
    expect(res.success).toBe(false);
    // Should not have validation errors about commission_type
    if (Array.isArray(res.data)) {
      expect(res.data.some(err => err.includes('commission_type'))).toBe(false);
    }
  });
});

const basePayload = {
  id: uuidv4(),
  name: "Test Record",
  json: JSON.stringify({ key: "value" }),
  related_forms: "form1,form2",
  icon: "test-icon",
  date_created: new Date().toISOString().slice(0, 19).replace('T', ' '),
  commission_type: "percent",
  opt_shareclient: true
};

describe('ts-orm CRUD operations', () => {
  const testId = uuidv4();
  const relatedId = uuidv4();

  const crudPayload = {
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
    const res = await create(table, struct, crudPayload);
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('id');
  });

  test('Insert multiple records for pagination', async () => {
    for (let i = 0; i < 5; i++) {
      const id = uuidv4();
      const payload = {
        ...crudPayload,
        id,
        name: `Record ${i}`,
        date_created: new Date(Date.now() + i * 1000).toISOString().slice(0, 19).replace('T', ' ')
      };
      const res = await create(table, struct, payload);
      expect(res.success).toBe(true);
    }
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

  test('Read sorted records with orderBy DESC', async () => {
    const res = await read(table, {}, {
      orderBy: 'date_created',
      direction: 'DESC'
    });
  
    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(5);
    expect(res.data[0].name).toMatch(/Record \d/); // Most recent first
  });

  test('Read records with limit and offset', async () => {
    const res = await read(table, {}, {
      orderBy: 'date_created',
      direction: 'ASC',
      limit: 2,
      offset: 1
    });
  
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(2);
  });
  
  test('ReadWith with joins, limit and sort', async () => {
    const res = await readWith(relatedTable, {}, [
      { table: table, on: [`${relatedTable}.ref_id`, `${table}.id`], type: 'inner' }
    ], {
      orderBy: `${relatedTable}.label`,
      direction: 'ASC',
      limit: 5,
      offset: 0
    });
  
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
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
      ...crudPayload,
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

  describe('Auto-increment ID support', () => {
    let insertedId;
  
    test('Create record without ID', async () => {
      const res = await create(autoTable, autoStruct, {
        title: 'Auto User'
      });
  
      expect(res.success).toBe(true);
      expect(res.data).toHaveProperty('id');
      insertedId = res.data.id;
    });
  
    test('Update record using auto-incremented ID', async () => {
      const res = await update(autoTable, autoStruct, {
        id: insertedId,
        title: 'Updated Auto User'
      });
  
      expect(res.success).toBe(true);
      expect(res.data.affectedRows).toBe(1);
    });
  
    test('Delete record using auto-incremented ID', async () => {
      const res = await remove(autoTable, 'id', insertedId);
      expect(res.success).toBe(true);
      expect(res.data.affectedRows).toBe(1);
    });

    test('Fails if auto_increment ID is manually included in insert', async () => {
      const res = await create(autoTable, autoStruct, {
        id: 999,
        title: 'Should Fail'
      });
    
      expect(res.success).toBe(false);
      expect(res.message).toBe('Validation failed');
      expect(res.data).toContain('id should not be provided (auto_increment)');
    });
    
  });

});
