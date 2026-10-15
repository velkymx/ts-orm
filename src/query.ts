/**
 * Fluent query builder. Conditions are collected as an AST, then compiled to
 * parameterized SQL through the active dialect, so one chain targets every
 * engine. Identifiers pass safeIdentifier, values are always bound.
 */

import type { Dialect } from './dialect.js';
import { safeIdentifier, escapeLike } from './identifiers.js';
import type { BuiltStatement } from './crud.js';
import { guarded } from './crud.js';
import type { BindValue, Driver } from './driver.js';
import type { Fields, RowOf, Struct } from './struct.js';
import { ok, type Result } from './result.js';

/** Comparison operators accepted by where and orWhere. */
export type ComparisonOperator =
  | '='
  | '!='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'LIKE'
  | 'like';

/** Join mode between sibling conditions. */
export type BooleanOp = 'AND' | 'OR';

/** Row lock modes for SELECT inside a transaction. Share locks allow concurrent reads. */
export type LockMode = 'update' | 'share';

/** Aggregate functions beyond COUNT. */
export type AggregateFn = 'SUM' | 'AVG' | 'MIN' | 'MAX';

/** One page of rows plus the totals needed to render pagination. */
export interface Page<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly lastPage: number;
}

/** Row shape after select(): the picked columns of the struct row. */
export type SelectedRow<F extends Fields, S extends keyof F & string> = Pick<
  RowOf<F>,
  Extract<keyof RowOf<F>, S>
>;

type ConditionNode =
  | { readonly kind: 'basic'; readonly boolean: BooleanOp; readonly column: string; readonly operator: string; readonly value: BindValue }
  | { readonly kind: 'in'; readonly boolean: BooleanOp; readonly column: string; readonly not: boolean; readonly values: readonly BindValue[] }
  | { readonly kind: 'between'; readonly boolean: BooleanOp; readonly column: string; readonly not: boolean; readonly low: BindValue; readonly high: BindValue }
  | { readonly kind: 'null'; readonly boolean: BooleanOp; readonly column: string; readonly not: boolean }
  | { readonly kind: 'like'; readonly boolean: BooleanOp; readonly column: string; readonly substring: string }
  | { readonly kind: 'group'; readonly boolean: BooleanOp; readonly children: readonly ConditionNode[] }
  | { readonly kind: 'tautology'; readonly boolean: BooleanOp; readonly value: boolean };

/** Nested group callback, receives a fresh sub builder for parenthesized conditions. */
export type GroupFn<Table extends string, F extends Fields> = (
  sub: QueryBuilder<Table, F>,
) => void;

/** Coerce to a non-negative integer, or undefined when not usable. */
function toCount(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Operators allowed to reach SQL. Everything else throws at build time. */
const SQL_OPERATORS: ReadonlySet<string> = new Set(['=', '!=', '<>', '<', '<=', '>', '>=', 'LIKE']);

/** Normalize operator text to the SQL emitted form, rejecting anything unlisted. */
function normalizeOperator(op: ComparisonOperator): string {
  const normalized = op === 'like' ? 'LIKE' : op;
  if (!SQL_OPERATORS.has(normalized)) {
    throw new Error(`Invalid comparison operator: ${String(op)}`);
  }
  return normalized;
}

interface Counter {
  n: number;
}

/**
 * Render the trailing lock clause for the dialect. SQLite locks through
 * its transaction, and mssql needs a FROM-clause hint instead, so both
 * throw rather than silently not locking.
 */
function compileLock(dialect: Dialect, mode: LockMode): string {
  if (dialect.name === 'postgres') {
    return mode === 'share' ? ' FOR SHARE' : ' FOR UPDATE';
  }
  if (dialect.name === 'mysql') {
    return mode === 'share' ? ' LOCK IN SHARE MODE' : ' FOR UPDATE';
  }
  throw new Error(`Row locking is not supported on ${dialect.name}: lock inside a transaction instead`);
}

function compileNode(
  node: ConditionNode,
  dialect: Dialect,
  counter: Counter,
  params: BindValue[],
): string {
  switch (node.kind) {
    case 'basic': {
      const col = safeIdentifier(node.column, dialect, 'column name');
      counter.n += 1;
      params.push(node.value);
      return `${col} ${node.operator} ${dialect.placeholder(counter.n)}`;
    }
    case 'in': {
      const col = safeIdentifier(node.column, dialect, 'column name');
      const marks = node.values.map((v) => {
        counter.n += 1;
        params.push(v);
        return dialect.placeholder(counter.n);
      });
      const keyword = node.not ? 'NOT IN' : 'IN';
      return `${col} ${keyword} (${marks.join(', ')})`;
    }
    case 'between': {
      const col = safeIdentifier(node.column, dialect, 'column name');
      counter.n += 1;
      const first = dialect.placeholder(counter.n);
      params.push(node.low);
      counter.n += 1;
      const second = dialect.placeholder(counter.n);
      params.push(node.high);
      const keyword = node.not ? 'NOT BETWEEN' : 'BETWEEN';
      return `${col} ${keyword} ${first} AND ${second}`;
    }
    case 'null': {
      const col = safeIdentifier(node.column, dialect, 'column name');
      return node.not ? `${col} IS NOT NULL` : `${col} IS NULL`;
    }
    case 'like': {
      const col = safeIdentifier(node.column, dialect, 'column name');
      counter.n += 1;
      params.push(`%${escapeLike(node.substring)}%` as BindValue);
      // MySQL processes backslash escapes inside string literals, so the
      // escape character must be doubled there; elsewhere one suffices.
      const escape = dialect.name === 'mysql' ? `'\\\\'` : `'\\'`;
      return `${col} LIKE ${dialect.placeholder(counter.n)} ESCAPE ${escape}`;
    }
    case 'tautology': {
      return node.value ? '1 = 1' : '1 = 0';
    }
    case 'group': {
      const parts = node.children.map((child) => compileNode(child, dialect, counter, params));
      if (parts.length === 0) return '1 = 1';
      let out = parts[0] as string;
      for (let i = 1; i < parts.length; i += 1) {
        const child = node.children[i] as ConditionNode;
        out += ` ${child.boolean} ${parts[i] as string}`;
      }
      return `(${out})`;
    }
  }
}

/** Join compiled sibling nodes, ignoring the leading boolean of the first node. */
function compileList(
  nodes: readonly ConditionNode[],
  dialect: Dialect,
  counter: Counter,
  params: BindValue[],
): string {
  const parts = nodes.map((node) => compileNode(node, dialect, counter, params));
  let out = parts[0] as string;
  for (let i = 1; i < parts.length; i += 1) {
    out += ` ${(nodes[i] as ConditionNode).boolean} ${parts[i] as string}`;
  }
  return out;
}

/**
 * Chainable SELECT builder bound to one struct and driver. Every method
 * returns this for chaining, toSQL compiles without I/O, get/first/count
 * execute.
 */
export class QueryBuilder<Table extends string, F extends Fields, S extends keyof F & string = keyof F & string> {
  private readonly driver: Driver;
  private readonly struct: Struct<Table, F>;
  private readonly nodes: ConditionNode[] = [];
  private selected: string[] = [];
  private orderCol: string | undefined = undefined;
  private orderDir: 'asc' | 'desc' = 'asc';
  private limitVal: number | undefined = undefined;
  private offsetVal: number | undefined = undefined;
  private softColumn: string | null = null;
  private includeTrashed = false;
  private lockMode: LockMode | undefined = undefined;

  constructor(driver: Driver, struct: Struct<Table, F>) {
    this.driver = driver;
    this.struct = struct;
  }

  private push(node: ConditionNode): this {
    this.nodes.push(node);
    return this;
  }

  private clone(): this {
    const copy = new QueryBuilder<Table, F, S>(this.driver, this.struct);
    for (const node of this.nodes) copy.nodes.push(node);
    copy.selected = [...this.selected];
    copy.orderCol = this.orderCol;
    copy.orderDir = this.orderDir;
    copy.limitVal = this.limitVal;
    copy.offsetVal = this.offsetVal;
    copy.softColumn = this.softColumn;
    copy.includeTrashed = this.includeTrashed;
    copy.lockMode = this.lockMode;
    return copy as this;
  }

  /** Add an AND condition: equality, operator form, or nested group callback. */
  where(
    columnOrFn: (keyof F & string) | GroupFn<Table, F>,
    opOrValue?: ComparisonOperator | BindValue,
    value?: BindValue,
  ): this {
    if (typeof columnOrFn === 'function') {
      const sub = new QueryBuilder<Table, F>(this.driver, this.struct);
      (columnOrFn as GroupFn<Table, F>)(sub);
      return this.push({ kind: 'group', boolean: 'AND', children: [...sub.nodes] });
    }
    const column = columnOrFn as string;
    if (value === undefined) {
      return this.push({ kind: 'basic', boolean: 'AND', column, operator: '=', value: opOrValue as BindValue });
    }
    return this.push({
      kind: 'basic',
      boolean: 'AND',
      column,
      operator: normalizeOperator(opOrValue as ComparisonOperator),
      value: value as BindValue,
    });
  }

  /** Add an OR condition: equality, operator form, or nested group callback. */
  orWhere(
    columnOrFn: (keyof F & string) | GroupFn<Table, F>,
    opOrValue?: ComparisonOperator | BindValue,
    value?: BindValue,
  ): this {
    if (typeof columnOrFn === 'function') {
      const sub = new QueryBuilder<Table, F>(this.driver, this.struct);
      (columnOrFn as GroupFn<Table, F>)(sub);
      return this.push({ kind: 'group', boolean: 'OR', children: [...sub.nodes] });
    }
    const column = columnOrFn as string;
    if (value === undefined) {
      return this.push({ kind: 'basic', boolean: 'OR', column, operator: '=', value: opOrValue as BindValue });
    }
    return this.push({
      kind: 'basic',
      boolean: 'OR',
      column,
      operator: normalizeOperator(opOrValue as ComparisonOperator),
      value: value as BindValue,
    });
  }

  /** AND IN condition, empty list compiles to always false. */
  whereIn(column: keyof F & string, values: readonly BindValue[]): this {
    if (values.length === 0) return this.push({ kind: 'tautology', boolean: 'AND', value: false });
    return this.push({ kind: 'in', boolean: 'AND', column, not: false, values: [...values] });
  }

  /** OR IN condition, empty list compiles to always false. */
  orWhereIn(column: keyof F & string, values: readonly BindValue[]): this {
    if (values.length === 0) return this.push({ kind: 'tautology', boolean: 'OR', value: false });
    return this.push({ kind: 'in', boolean: 'OR', column, not: false, values: [...values] });
  }

  /** AND NOT IN condition, empty list compiles to always true. */
  whereNotIn(column: keyof F & string, values: readonly BindValue[]): this {
    if (values.length === 0) return this.push({ kind: 'tautology', boolean: 'AND', value: true });
    return this.push({ kind: 'in', boolean: 'AND', column, not: true, values: [...values] });
  }

  /** OR NOT IN condition, empty list compiles to always true. */
  orWhereNotIn(column: keyof F & string, values: readonly BindValue[]): this {
    if (values.length === 0) return this.push({ kind: 'tautology', boolean: 'OR', value: true });
    return this.push({ kind: 'in', boolean: 'OR', column, not: true, values: [...values] });
  }

  /** AND BETWEEN condition with two bound values. */
  whereBetween(column: keyof F & string, low: BindValue, high: BindValue): this {
    return this.push({ kind: 'between', boolean: 'AND', column, not: false, low, high });
  }

  /** OR BETWEEN condition with two bound values. */
  orWhereBetween(column: keyof F & string, low: BindValue, high: BindValue): this {
    return this.push({ kind: 'between', boolean: 'OR', column, not: false, low, high });
  }

  /** AND NOT BETWEEN condition with two bound values. */
  whereNotBetween(column: keyof F & string, low: BindValue, high: BindValue): this {
    return this.push({ kind: 'between', boolean: 'AND', column, not: true, low, high });
  }

  /** OR NOT BETWEEN condition with two bound values. */
  orWhereNotBetween(column: keyof F & string, low: BindValue, high: BindValue): this {
    return this.push({ kind: 'between', boolean: 'OR', column, not: true, low, high });
  }

  /** AND IS NULL condition, emits no params. */
  whereNull(column: keyof F & string): this {
    return this.push({ kind: 'null', boolean: 'AND', column, not: false });
  }

  /** OR IS NULL condition, emits no params. */
  orWhereNull(column: keyof F & string): this {
    return this.push({ kind: 'null', boolean: 'OR', column, not: false });
  }

  /** AND IS NOT NULL condition, emits no params. */
  whereNotNull(column: keyof F & string): this {
    return this.push({ kind: 'null', boolean: 'AND', column, not: true });
  }

  /** OR IS NOT NULL condition, emits no params. */
  orWhereNotNull(column: keyof F & string): this {
    return this.push({ kind: 'null', boolean: 'OR', column, not: true });
  }

  /** AND contains-match with user input escaped, so % and _ stay literal. */
  whereLike(column: keyof F & string, substring: string): this {
    return this.push({ kind: 'like', boolean: 'AND', column, substring });
  }

  /** OR contains-match with user input escaped, so % and _ stay literal. */
  orWhereLike(column: keyof F & string, substring: string): this {
    return this.push({ kind: 'like', boolean: 'OR', column, substring });
  }

  /**
   * Apply the soft delete scope: rows stamped in the column stay hidden.
   * Explicit plumbing for models and relation loaders; the raw factory
   * never scopes, so plain builder use keeps exact SQL semantics.
   */
  softScope(column: string): this {
    this.softColumn = column;
    return this;
  }

  /** Lift the soft delete scope, showing trashed rows too. No-op when unscoped. */
  withTrashed(): this {
    this.includeTrashed = true;
    return this;
  }

  /**
   * Lock selected rows for a read-modify-write inside a transaction.
   * Meaningful only when executed on a tx handle; elsewhere the engine
   * releases the lock at statement end. Throws at compile time on
   * sqlite and mssql, which have no SELECT-level lock spelling.
   */
  forUpdate(mode: LockMode = 'update'): this {
    this.lockMode = mode;
    return this;
  }

  /** Restrict the SELECT column list, defaults to all columns. */
  /**
   * Restrict the SELECT column list, narrowing the row type to match.
   * Mutates like every other chain method; narrowing follows the type.
   */
  select<S2 extends keyof F & string>(...columns: S2[]): QueryBuilder<Table, F, S2> {
    this.selected = [...columns] as string[];
    return this as unknown as QueryBuilder<Table, F, S2>;
  }

  /** Add ORDER BY, direction defaults to ascending. */
  orderBy(column: keyof F & string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderCol = column as string;
    this.orderDir = direction.toLowerCase() === 'desc' ? 'desc' : 'asc';
    return this;
  }

  /** Cap the row count, non-integer or negative values are ignored. */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /** Skip rows, requires limit to take effect on some dialects. */
  offset(n: number): this {
    this.offsetVal = n;
    return this;
  }

  private buildWhere(dialect: Dialect, counter: Counter, params: BindValue[]): string {
    const scoped = this.softColumn !== null && !this.includeTrashed;
    if (this.nodes.length === 0 && !scoped) return '';
    const soft =
      scoped === true
        ? `${safeIdentifier(this.softColumn as string, dialect, 'column name')} IS NULL`
        : '';
    if (this.nodes.length === 0) return ` WHERE ${soft}`;
    const compiled = compileList(this.nodes, dialect, counter, params);
    // Parenthesize user conditions: a trailing OR must not escape the scope.
    return scoped === true ? ` WHERE (${compiled}) AND ${soft}` : ` WHERE ${compiled}`;
  }

  private buildOrder(dialect: Dialect): string {
    if (!this.orderCol) return '';
    const dir = this.orderDir === 'desc' ? 'DESC' : 'ASC';
    return ` ORDER BY ${safeIdentifier(this.orderCol, dialect, 'order by column')} ${dir}`;
  }

  /** Compile the SELECT to parameterized SQL plus bound values. Raw escape hatch. */
  toSQL(): BuiltStatement {
    const dialect = this.driver.dialect;
    const counter: Counter = { n: 0 };
    const params: BindValue[] = [];
    const table = safeIdentifier(this.struct.table, dialect, 'table name');
    const columns =
      this.selected.length > 0
        ? this.selected.map((c) => safeIdentifier(c, dialect, 'column name')).join(', ')
        : '*';
    const where = this.buildWhere(dialect, counter, params);
    let order = this.buildOrder(dialect);
    const paging = dialect.limitOffset(toCount(this.limitVal), toCount(this.offsetVal));
    if (dialect.name === 'mssql' && paging && !order) {
      order = ' ORDER BY (SELECT NULL)';
    }
    let sql = `SELECT ${columns} FROM ${table}${where}`;
    if (order) sql += order;
    if (paging) sql += ` ${paging}`;
    if (this.lockMode !== undefined) sql += compileLock(dialect, this.lockMode);
    return { sql, params };
  }

  /** Compile the COUNT over the same filters, ignoring order and paging. Raw hatch. */
  toCountSQL(column: (keyof F & string) | '*' = '*'): BuiltStatement {
    const target = column === '*' ? '*' : this.columnTarget(column as string);
    return this.aggregateSQL('COUNT', target, 'count');
  }

  /** Compile SUM/AVG/MIN/MAX over the same filters, ignoring order and paging. Raw hatch. */
  toAggregateSQL(fn: AggregateFn, column: keyof F & string): BuiltStatement {
    return this.aggregateSQL(fn, this.columnTarget(column as string), fn.toLowerCase());
  }

  /** Shared aggregate compiler: function over a target with an aliased output. */
  private aggregateSQL(fn: string, target: string, alias: string): BuiltStatement {
    const dialect = this.driver.dialect;
    const counter: Counter = { n: 0 };
    const params: BindValue[] = [];
    const table = safeIdentifier(this.struct.table, dialect, 'table name');
    const name = safeIdentifier(alias, dialect, 'column name');
    const where = this.buildWhere(dialect, counter, params);
    return { sql: `SELECT ${fn}(${target}) AS ${name} FROM ${table}${where}`, params };
  }

  /** Validate one column for aggregate output, returning it quoted. */
  private columnTarget(column: string): string {
    return safeIdentifier(column, this.driver.dialect, 'column name');
  }

  /** Execute the SELECT and return all matching rows. */
  async get(this: QueryBuilder<Table, F>): Promise<Result<RowOf<F>[]>>;
  async get(): Promise<Result<SelectedRow<F, S>[]>>;
  async get(): Promise<Result<RowOf<F>[]>> {
    return guarded('query', async () => {
      const { sql, params } = this.toSQL();
      const rows = await this.driver.query<RowOf<F>>(sql, params);
      return ok(rows, 'Data retrieved');
    });
  }

  /** Execute with limit 1 and return the first row or null. */
  async first(this: QueryBuilder<Table, F>): Promise<Result<RowOf<F> | null>>;
  async first(): Promise<Result<SelectedRow<F, S> | null>>;
  async first(): Promise<Result<RowOf<F> | null>> {
    const copy = this.clone();
    copy.limitVal = 1;
    const result = await copy.get();
    if (!result.success) return result;
    const row = result.data[0];
    return row === undefined ? ok(null, 'Record not found') : ok(row, 'Record found');
  }

  /** Execute COUNT over the current filters and return the total. */
  async count(column: (keyof F & string) | '*' = '*'): Promise<Result<number>> {
    return guarded('query', async () => {
      const { sql, params } = this.toCountSQL(column);
      const rows = await this.driver.query<Record<string, unknown>>(sql, params);
      const first = rows[0];
      const value = first ? first['count'] : 0;
      return ok(Number(value), 'Count retrieved');
    });
  }

  /** Run one aggregate and return its value, or null when no rows match. */
  private async aggregate(fn: AggregateFn, column: keyof F & string): Promise<Result<number | null>> {
    return guarded('query', async () => {
      const { sql, params } = this.toAggregateSQL(fn, column);
      const rows = await this.driver.query<Record<string, unknown>>(sql, params);
      const value = rows[0]?.[fn.toLowerCase()];
      if (value === null || value === undefined) {
        return ok(null, `${fn} retrieved`);
      }
      return ok(Number(value), `${fn} retrieved`);
    });
  }

  /** Sum a column over the current filters, or null when no rows match. */
  async sum(column: keyof F & string): Promise<Result<number | null>> {
    return this.aggregate('SUM', column);
  }

  /** Average a column over the current filters, or null when no rows match. */
  async avg(column: keyof F & string): Promise<Result<number | null>> {
    return this.aggregate('AVG', column);
  }

  /** Minimum of a column over the current filters, or null when no rows match. */
  async min(column: keyof F & string): Promise<Result<number | null>> {
    return this.aggregate('MIN', column);
  }

  /** Maximum of a column over the current filters, or null when no rows match. */
  async max(column: keyof F & string): Promise<Result<number | null>> {
    return this.aggregate('MAX', column);
  }

  /**
   * One page plus totals. Page floors to 1 and perPage clamps to 1..100,
   * so hostile input cannot request unbounded rows.
   */
  async paginate(
    this: QueryBuilder<Table, F>,
    page: number,
    perPage: number,
  ): Promise<Page<RowOf<F>>>;
  async paginate(page: number, perPage: number): Promise<Page<SelectedRow<F, S>>>;
  async paginate(page: number, perPage: number): Promise<Page<RowOf<F>>> {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePerPage = Number.isInteger(perPage) ? Math.min(100, Math.max(1, perPage)) : 10;
    const total = await this.count();
    if (!total.success) {
      throw new Error(total.errors.join(', '));
    }
    const rows = await this.clone().limit(safePerPage).offset((safePage - 1) * safePerPage).get();
    if (!rows.success) {
      throw new Error(rows.errors.join(', '));
    }
    return {
      data: rows.data,
      total: total.data,
      page: safePage,
      perPage: safePerPage,
      lastPage: Math.ceil(total.data / safePerPage),
    };
  }

  /** Compile the DELETE over the same filters, ignoring order and paging. Raw hatch. */
  toDeleteSQL(): BuiltStatement {
    const dialect = this.driver.dialect;
    const counter: Counter = { n: 0 };
    const params: BindValue[] = [];
    const table = safeIdentifier(this.struct.table, dialect, 'table name');
    const where = this.buildWhere(dialect, counter, params);
    return { sql: `DELETE FROM ${table}${where}`, params };
  }

  /** Execute DELETE over the current filters and return the affected rows. */
  async delete(): Promise<Result<{ affectedRows: number }>> {
    return guarded('query', async () => {
      const { sql, params } = this.toDeleteSQL();
      const result = await this.driver.execute(sql, params);
      return ok({ affectedRows: result.affectedRows }, 'Records deleted');
    });
  }
}

/** Start a fluent SELECT over a struct on the given driver. */
export function query<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
): QueryBuilder<Table, F> {
  return new QueryBuilder<Table, F>(driver, struct);
}
