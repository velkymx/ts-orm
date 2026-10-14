import { describe, it, expect } from 'vitest';
import { query } from '../src/query.js';
import { defineStruct } from '../src/struct.js';
import type { Result } from '../src/result.js';
import { mysql, postgres } from '../src/dialect.js';
import { createSqliteDriver } from '../src/drivers/sqlite.js';
import type { Driver } from '../src/driver.js';

const Order = defineStruct('orders', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  status: { type: 'string', required: true, length: 20 },
  total: { type: 'number' },
});

function fakeDriver(dialect = mysql): Driver {
  return {
    dialect,
    query: async <Row>(): Promise<Row[]> => [],
    execute: async () => ({ affectedRows: 0 }),
    close: async () => {},
  };
}

/** Unwrap a Result in tests, failing loudly on driver errors. */
async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.success) {
    throw new Error(result.errors.join(', '));
  }
  return result.data;
}

describe('aggregates (issue 25)', () => {
  it('compiles SUM/AVG/MIN/MAX over the same filters', () => {
    const b = query(fakeDriver(), Order).where('status', 'paid');
    expect(b.toAggregateSQL('SUM', 'total')).toEqual({
      sql: 'SELECT SUM(`total`) AS `sum` FROM `orders` WHERE `status` = ?',
      params: ['paid'],
    });
    expect(b.toAggregateSQL('AVG', 'total').sql).toBe(
      'SELECT AVG(`total`) AS `avg` FROM `orders` WHERE `status` = ?',
    );
    expect(b.toAggregateSQL('MIN', 'total').sql).toContain('MIN(`total`) AS `min`');
    expect(b.toAggregateSQL('MAX', 'total').sql).toContain('MAX(`total`) AS `max`');
  });

  it('numbers placeholders per dialect', () => {
    const b = query(fakeDriver(postgres), Order).where('status', 'paid').where('id', 3);
    expect(b.toAggregateSQL('SUM', 'total')).toEqual({
      sql: 'SELECT SUM("total") AS "sum" FROM "orders" WHERE "status" = $1 AND "id" = $2',
      params: ['paid', 3],
    });
  });

  it('rejects bad aggregate columns', () => {
    expect(() => query(fakeDriver(), Order).toAggregateSQL('SUM', 't; DROP' as never)).toThrow();
  });

  it('returns numeric aggregates over real rows (sqlite integration)', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "status" TEXT, "total" INTEGER)',
      [],
    );
    for (const [status, total] of [['paid', 10], ['paid', 20], ['paid', 30], ['open', 5]] as const) {
      await driver.execute('INSERT INTO "orders" ("status", "total") VALUES (?, ?)', [status, total]);
    }
    const paid = query(driver, Order).where('status', 'paid');
    expect(await unwrap(paid.sum('total'))).toBe(60);
    expect(await unwrap(paid.avg('total'))).toBe(20);
    expect(await unwrap(paid.min('total'))).toBe(10);
    expect(await unwrap(paid.max('total'))).toBe(30);
    const none = await unwrap(query(driver, Order).where('status', 'void').sum('total'));
    expect(none).toBeNull();
    await driver.close();
  });
});

describe('paginate (issue 25)', () => {
  it('returns the envelope with correct totals and pages', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "status" TEXT, "total" INTEGER)',
      [],
    );
    for (let i = 1; i <= 5; i += 1) {
      await driver.execute('INSERT INTO "orders" ("status", "total") VALUES (?, ?)', ['paid', i * 10]);
    }
    const base = query(driver, Order).where('status', 'paid').orderBy('id', 'asc');
    const page1 = await base.paginate(1, 2);
    expect(page1).toEqual({
      data: [
        { id: 1, status: 'paid', total: 10 },
        { id: 2, status: 'paid', total: 20 },
      ],
      total: 5,
      page: 1,
      perPage: 2,
      lastPage: 3,
    });
    const page3 = await base.paginate(3, 2);
    expect(page3.data.map((r) => r.id)).toEqual([5]);
    expect(page3.lastPage).toBe(3);
    await driver.close();
  });

  it('coerces out-of-range paging input', async () => {
    const driver = createSqliteDriver({ filename: ':memory:' });
    await driver.execute(
      'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "status" TEXT, "total" INTEGER)',
      [],
    );
    await driver.execute('INSERT INTO "orders" ("status", "total") VALUES (?, ?)', ['paid', 1]);
    const base = query(driver, Order).orderBy('id', 'asc');
    const coerced = await base.paginate(0, 500);
    expect(coerced.page).toBe(1);
    expect(coerced.perPage).toBe(100);
    expect(coerced.total).toBe(1);
    await driver.close();
  });
});
