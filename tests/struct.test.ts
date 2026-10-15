import { describe, it, expect } from 'vitest';
import {
  defineStruct,
  type RowOf,
  type InsertOf,
  type UpdateOf,
} from '../src/struct.js';

const User = defineStruct('users', {
  id: { type: 'uuid', required: true, default: 'auto_increment' },
  email: { type: 'string', required: true, length: 255 },
  age: { type: 'number' },
  role: { type: 'enum', enum: ['admin', 'staff', 'user'] },
  created_at: { type: 'datetime', default: 'current_timestamp' },
});

type UserFields = typeof User.fields;

// Compile-time exact-equality assertion. tsc fails the build if any Equal is false.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type _row = Expect<
  Equal<
    RowOf<UserFields>,
    {
      id: string;
      email: string;
      age?: number;
      role?: 'admin' | 'staff' | 'user';
      created_at?: string;
    }
  >
>;

type _insert = Expect<
  Equal<
    InsertOf<UserFields>,
    {
      email: string;
      age?: number;
      role?: 'admin' | 'staff' | 'user';
      created_at?: string;
    }
  >
>;

type _update = Expect<
  Equal<
    UpdateOf<UserFields>,
    {
      id?: string;
      email?: string;
      age?: number;
      role?: 'admin' | 'staff' | 'user';
      created_at?: string;
    }
  >
>;

type _table = Expect<Equal<typeof User.table, 'users'>>;

const Money = defineStruct('ledger', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  amount: { type: 'decimal', required: true },
  seq: { type: 'bigint' },
});

type _money = Expect<
  Equal<RowOf<typeof Money.fields>, { id: number; amount: string; seq?: string }>
>;

describe('defineStruct runtime shape', () => {
  it('carries the table name', () => {
    expect(User.table).toBe('users');
  });

  it('carries the field definitions verbatim', () => {
    expect(User.fields.email).toEqual({ type: 'string', required: true, length: 255 });
    expect(User.fields.role.enum).toEqual(['admin', 'staff', 'user']);
  });

  it('exposes column name keys', () => {
    expect(Object.keys(User.fields)).toEqual(['id', 'email', 'age', 'role', 'created_at']);
  });

  it('input mutation after definition cannot alter the struct', () => {
    const input = {
      name: { type: 'string' as const, required: true },
      role: { type: 'enum' as const, enum: ['admin', 'user'] },
    };
    const S = defineStruct('t', input);
    (input as Record<string, unknown>).name = { type: 'number' };
    (input.role.enum as string[]).push('root');
    expect(S.fields.name).toEqual({ type: 'string', required: true });
    expect(S.fields.role.enum).toEqual(['admin', 'user']);
    expect(Object.isFrozen(S.fields)).toBe(true);
    expect(Object.isFrozen(S.fields.role.enum)).toBe(true);
  });
});

describe('type-level inference', () => {
  it('row / insert / update / table shapes compile', () => {
    // Reference the assertions so the module keeps them; failures surface in tsc.
    const checks: [_row, _insert, _update, _table, _money] = [true, true, true, true, true];
    expect(checks.every(Boolean)).toBe(true);
  });
});
