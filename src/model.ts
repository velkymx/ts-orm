/**
 * Model base class. defineModel binds one driver plus one struct into an
 * extendable class, so each table is declared once. Statics delegate to the
 * CRUD functions and the query builder, instances hydrate rows and track
 * dirtiness against a snapshot so save writes only changed columns. Any
 * method accepts an optional driver, and a transaction connection fits that
 * slot, so multi-model writes stay atomic.
 */

import {
  buildUpdate,
  create as createRow,
  findOrFail as findOrFailRow,
  primaryKey,
  read,
  readOne,
  remove,
} from './crud.js';
import type { BindValue, Driver } from './driver.js';
import { QueryBuilder, query } from './query.js';
import type { Fields, InsertOf, RowOf, Struct } from './struct.js';

/** Hydrated instance surface: fill, dirtiness, persistence, row export. */
export interface ModelInstance<F extends Fields> {
  /** Merge fields into the instance, marking them dirty. */
  fill(data: Partial<RowOf<F>>): this;
  /** True when any field (or the named one) differs from the snapshot. */
  isDirty(column?: keyof F & string): boolean;
  /** The fields that differ from the snapshot. */
  getChanges(): Partial<RowOf<F>>;
  /** A copy of the current attributes. */
  toRow(): RowOf<F>;
  /** Insert when keyless, else update dirty fields only. */
  save(driver?: Driver): Promise<this>;
  /** Delete the row for this instance's key. */
  delete(driver?: Driver): Promise<void>;
}

/** Class surface returned by defineModel: finders plus construction. */
export interface ModelStatic<Table extends string, F extends Fields> {
  /** Construct an unpersisted instance, dirty with the given fields. */
  new (data?: Partial<RowOf<F>>): ModelInstance<F>;
  /** The bound driver and struct, for advanced use. */
  readonly boundDriver: Driver;
  readonly boundStruct: Struct<Table, F>;
  /** Wrap a raw row as an instance with a clean snapshot. */
  hydrate<T>(this: new (data?: Partial<RowOf<F>>) => T, row: RowOf<F>): T;
  /** Find by primary key, or null when absent. */
  find<T>(this: new (data?: Partial<RowOf<F>>) => T, id: BindValue, driver?: Driver): Promise<T | null>;
  /** Find by primary key, throwing NotFoundError when absent. */
  findOrFail<T>(this: new (data?: Partial<RowOf<F>>) => T, id: BindValue, driver?: Driver): Promise<T>;
  /** All rows as instances. */
  all<T>(this: new (data?: Partial<RowOf<F>>) => T, driver?: Driver): Promise<T[]>;
  /** Validate, insert, and return the hydrated instance. */
  create<T>(this: new (data?: Partial<RowOf<F>>) => T, payload: InsertOf<F>, driver?: Driver): Promise<T>;
  /** Fluent builder over this model table, rows come back unhydrated. */
  query(driver?: Driver): QueryBuilder<Table, F>;
}

/**
 * Bind a driver plus a struct into an extendable model class. Extend the
 * result to add domain methods; every method stays typed by the struct.
 */
export function defineModel<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
): ModelStatic<Table, F> {
  type Row = RowOf<F>;
  const pk = primaryKey(struct.fields);
  const key = pk as keyof F & string;
  const pick = (drv: Driver | undefined): Driver => drv ?? driver;

  function failMessage(message: string, errors: readonly string[]): string {
    return errors.length > 0 ? `${message}: ${errors.join(', ')}` : message;
  }

  class Model {
    static readonly boundDriver: Driver = driver;
    static readonly boundStruct: Struct<Table, F> = struct;

    protected attributes: Row;
    protected original: Row;

    constructor(data: Partial<Row> = {}) {
      this.attributes = { ...(data as Row) };
      this.original = {} as Row;
    }

    static hydrate<T extends Model>(this: new (data?: Partial<Row>) => T, row: Row): T {
      const instance = new this();
      instance.attributes = { ...row };
      instance.original = { ...row };
      return instance;
    }

    static async find<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      id: BindValue,
      drv?: Driver,
    ): Promise<T | null> {
      const result = await readOne(pick(drv), struct, { [pk]: id } as Partial<Row>);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      return result.data === null ? null : this.hydrate(result.data);
    }

    static async findOrFail<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      id: BindValue,
      drv?: Driver,
    ): Promise<T> {
      return this.hydrate(await findOrFailRow(pick(drv), struct, key, id));
    }

    static async all<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      drv?: Driver,
    ): Promise<T[]> {
      const result = await read(pick(drv), struct, {}, {});
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      return result.data.map((row) => this.hydrate(row));
    }

    static async create<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      payload: InsertOf<F>,
      drv?: Driver,
    ): Promise<T> {
      const result = await createRow(pick(drv), struct, payload);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      const row = { ...(payload as Partial<Row>) };
      if (result.data.id !== undefined) {
        (row as Record<string, unknown>)[pk] = result.data.id;
      }
      return this.hydrate(row as Row);
    }

    static query(drv?: Driver): QueryBuilder<Table, F> {
      return query(pick(drv), struct);
    }

    fill(data: Partial<Row>): this {
      Object.assign(this.attributes, data);
      return this;
    }

    toRow(): Row {
      return { ...this.attributes };
    }

    private dirtyKeys(): (keyof Row)[] {
      const names = new Set([
        ...Object.keys(this.attributes),
        ...Object.keys(this.original),
      ]);
      const out: (keyof Row)[] = [];
      for (const name of names) {
        const current = (this.attributes as Record<string, unknown>)[name] as unknown;
        const base = (this.original as Record<string, unknown>)[name] as unknown;
        if (!Object.is(current, base)) {
          out.push(name as keyof Row);
        }
      }
      return out;
    }

    isDirty(column?: keyof F & string): boolean {
      const keys = this.dirtyKeys();
      return column === undefined ? keys.length > 0 : keys.includes(column as keyof Row);
    }

    getChanges(): Partial<Row> {
      const changes: Record<string, unknown> = {};
      for (const name of this.dirtyKeys()) {
        changes[name as string] = (this.attributes as Record<string, unknown>)[name as string];
      }
      return changes as Partial<Row>;
    }

    async save(drv?: Driver): Promise<this> {
      const target = pick(drv);
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        const result = await createRow(target, struct, this.attributes as InsertOf<F>);
        if (!result.success) {
          throw new Error(failMessage(result.message, result.errors));
        }
        if (result.data.id !== undefined) {
          (this.attributes as Record<string, unknown>)[pk] = result.data.id;
        }
        this.original = { ...this.attributes };
        return this;
      }
      const changes = this.getChanges();
      if (Object.keys(changes).length === 0) {
        return this;
      }
      const { sql, params } = buildUpdate(target.dialect, struct, {
        ...(changes as Record<string, unknown>),
        [pk]: id,
      }, pk);
      await target.execute(sql, params);
      this.original = { ...this.attributes };
      return this;
    }

    async delete(drv?: Driver): Promise<void> {
      const target = pick(drv);
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        throw new Error('Cannot delete a model without a primary key value');
      }
      const result = await remove(target, struct, key, id);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
    }
  }

  return Model as unknown as ModelStatic<Table, F>;
}
