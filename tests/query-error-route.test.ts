import { describe, it, expect, afterEach } from 'vitest';
import { query } from '../src/query.js';
import { readWith } from '../src/crud.js';
import { defineStruct } from '../src/struct.js';
import { setLogger, resetLogger } from '../src/errors.js';
import type { Driver } from '../src/driver.js';
import { sqlite } from '../src/dialect.js';

const User = defineStruct('users', {
  id: { type: 'number', required: true },
  email: { type: 'string', required: true },
});

function failingDriver(): Driver {
  const boom = new Error('raw engine detail: table exploded');
  return {
    dialect: sqlite,
    query: async <Row>(): Promise<Row[]> => {
      throw boom;
    },
    execute: async () => {
      throw boom;
    },
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
}

afterEach(() => resetLogger());

describe('builder error route (issue 121)', () => {
  it('logs detail and returns the mapped safe message on get', async () => {
    const logged: unknown[] = [];
    setLogger((_m, detail) => logged.push(detail));
    const result = await query(failingDriver(), User).where('id', 1).get();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).not.toMatch(/exploded/);
      expect(JSON.stringify(result)).not.toMatch(/exploded/);
    }
    expect(logged).toHaveLength(1);
  });

  it('routes count, first, and delete through the same logger', async () => {
    const logged: unknown[] = [];
    setLogger((_m, detail) => logged.push(detail));
    const driver = failingDriver();
    expect((await query(driver, User).count()).success).toBe(false);
    expect((await query(driver, User).first()).success).toBe(false);
    expect((await query(driver, User).where('id', 1).delete()).success).toBe(false);
    expect(logged).toHaveLength(3);
  });

  it('routes readWith through the same logger', async () => {
    const logged: unknown[] = [];
    setLogger((_m, detail) => logged.push(detail));
    const result = await readWith(failingDriver(), User, []);
    expect(result.success).toBe(false);
    expect(logged).toHaveLength(1);
  });
});
