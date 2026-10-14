/**
 * Model base class. defineModel binds one driver plus one struct into an
 * extendable class, so each table is declared once. Statics delegate to the
 * CRUD functions and the query builder, instances hydrate rows and track
 * dirtiness against a snapshot so save writes only changed columns. Any
 * method accepts an optional driver, and a transaction connection fits that
 * slot, so multi-model writes stay atomic.
 */

import {
  buildSoftUpdate,
  buildSoftRestore,
  buildUpdate,
  create as createRow,
  findOrFail as findOrFailRow,
  primaryKey,
  read,
  readOne,
  remove,
} from './crud.js';
import { validatePayload } from './validation.js';
import type { BindValue, Driver } from './driver.js';
import { getDefaultDriver } from './default-driver.js';
import { deliver, runHooks, timestampHooks, type HookContext, type ModelHooks } from './lifecycle.js';
import { castIn, castOut, valuesEqual, type Casts } from './casts.js';
import { isTrashed, softColumnOf, softStamp } from './soft.js';
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
  /**
   * Affected rows of the last save, delete, restore, or forceDelete on this
   * instance, null before any write runs. Zero means the write matched
   * nothing; what that means for the flow is the caller's decision.
   * Counts follow the engine: matched rows everywhere except MySQL, which
   * reports changed rows unless CLIENT_FOUND_ROWS is set.
   */
  lastAffectedRows: number | null;
  /** Insert when keyless, else update dirty fields only. */
  save(driver?: Driver): Promise<this>;
  /** Delete the row for this instance's key. */
  delete(driver?: Driver): Promise<{ affectedRows: number }>;
  /**
   * Clear the soft delete stamp, hiding nothing and firing
   * restoring/restored. No-op when not trashed. Requires soft deletes.
   */
  restore(driver?: Driver): Promise<this>;
  /**
   * Physically remove the row with forceDeleting/forceDeleted hooks.
   * Idempotent: repeating after the row is gone still succeeds.
   * Requires soft deletes.
   */
  forceDelete(driver?: Driver): Promise<{ affectedRows: number }>;
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
  /** Per-model hook table. Absent means the lifecycle passes through silently. */
  readonly hooks?: ModelHooks<F>;
  /** Automatic created_at and updated_at handling. Set false to opt out. */
  readonly timestamps?: boolean;
  /** App-shape casts by column. Unlisted columns pass through untouched. */
  readonly casts?: Casts;
  /**
   * Soft deletes: delete stamps deleted_at and reads hide stamped rows.
   * Requires a deleted_at column; the flag without the column throws.
   */
  readonly softDeletes?: boolean;
  /** Unscoped reads over trashed rows too: find, findOrFail, all, query. */
  withTrashed<T>(
    this: new (data?: Partial<RowOf<F>>) => T,
  ): ScopedReads<Table, F, T>;
  /** Delete rows matching equality conditions in one statement. */
  deleteWhere(conditions: Partial<RowOf<F>>, driver?: Driver): Promise<{ affectedRows: number }>;
  /** Fluent builder over this model table, rows come back unhydrated. */
  query(driver?: Driver): QueryBuilder<Table, F>;
}

/** Unscoped read surface: same shapes as the model, trashed rows included. */
export interface ScopedReads<Table extends string, F extends Fields, T> {
  /** Find by primary key, or null when absent. */
  find(id: BindValue, driver?: Driver): Promise<T | null>;
  /** Find by primary key, throwing NotFoundError when absent. */
  findOrFail(id: BindValue, driver?: Driver): Promise<T>;
  /** All rows as instances. */
  all(driver?: Driver): Promise<T[]>;
  /** Fluent builder with no soft scope, rows come back unhydrated. */
  query(driver?: Driver): QueryBuilder<Table, F>;
}

/**
 * Bind a driver plus a struct into an extendable model class. Extend the
 * result to add domain methods; every method stays typed by the struct.
 * Pass the struct first to use the shared environment driver; pass an
 * explicit driver (either position) to override it, e.g. per test or tx.
 */
export function defineModel<Table extends string, F extends Fields>(
  driver: Driver,
  struct: Struct<Table, F>,
): ModelStatic<Table, F>;
export function defineModel<Table extends string, F extends Fields>(
  struct: Struct<Table, F>,
  driver?: Driver,
): ModelStatic<Table, F>;
export function defineModel<Table extends string, F extends Fields>(
  first: Driver | Struct<Table, F>,
  second?: Driver | Struct<Table, F>,
): ModelStatic<Table, F> {
  const isStruct = (value: unknown): value is Struct<Table, F> =>
    typeof value === 'object' &&
    value !== null &&
    'table' in value &&
    'fields' in value;
  const driver = isStruct(first)
    ? ((second as Driver | undefined) ?? getDefaultDriver())
    : (first as Driver);
  const struct = (isStruct(first) ? first : second) as Struct<Table, F>;
  type Row = RowOf<F>;
  const pk = primaryKey(struct.fields);
  const key = pk as keyof F & string;
  const pick = (drv: Driver | undefined): Driver => drv ?? driver;

  function failMessage(message: string, errors: readonly string[]): string {
    return errors.length > 0 ? `${message}: ${errors.join(', ')}` : message;
  }

  /** Unscoped reread of one row for race checks. Throws on driver failure. */
  async function freshRow(target: Driver, id: BindValue): Promise<Row | null> {
    const result = await readOne(target, struct, { [pk]: id } as Partial<Row>);
    if (!result.success) {
      throw new Error(failMessage(result.message, result.errors));
    }
    return result.data;
  }

  function hooksOf(ctor: unknown): ModelHooks<F> | undefined {
    return (ctor as { hooks?: ModelHooks<F> }).hooks;
  }

  function stampsOf(ctor: unknown): ModelHooks<F> | undefined {
    const flag = (ctor as { timestamps?: boolean }).timestamps ?? true;
    return flag ? timestampHooks(struct) : undefined;
  }

  function castsOf(ctor: unknown): Casts {
    return (ctor as { casts?: Casts }).casts ?? {};
  }

  /** Live-attribute context for before-hooks, so stamps and custom defaults flow downstream. */
  function live(attributes: Row, changes: Partial<Row>): HookContext<F> {
    return { attributes, changes };
  }

  function context(attributes: Row, changes: Partial<Row>): HookContext<F> {
    return { attributes: { ...attributes }, changes: { ...changes } };
  }

  class Model {
    static readonly boundDriver: Driver = driver;
    static readonly boundStruct: Struct<Table, F> = struct;
    static hooks: ModelHooks<F> | undefined = undefined;
    static timestamps: boolean = true;
    static casts: Casts = {};
    static softDeletes: boolean = false;

    protected attributes: Row;
    protected original: Row;
    lastAffectedRows: number | null = null;

    constructor(data: Partial<Row> = {}) {
      this.attributes = { ...(data as Row) };
      this.original = {} as Row;
    }

    static hydrate<T extends Model>(this: new (data?: Partial<Row>) => T, row: Row): T {
      const instance = new this();
      const casted = castOut({ ...(row as Record<string, unknown>) }, castsOf(this)) as Row;
      instance.attributes = { ...casted };
      instance.original = { ...casted };
      return instance;
    }

    static async find<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      id: BindValue,
      drv?: Driver,
    ): Promise<T | null> {
      const soft = softColumnOf(this, struct);
      const options = soft === null ? {} : { isNull: [soft] };
      const result = await readOne(pick(drv), struct, { [pk]: id } as Partial<Row>, options);
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
      const soft = softColumnOf(this, struct);
      const options = soft === null ? {} : { isNull: [soft] };
      return this.hydrate(await findOrFailRow(pick(drv), struct, key, id, options));
    }

    static async all<T extends Model>(
      this: (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T },
      drv?: Driver,
    ): Promise<T[]> {
      const soft = softColumnOf(this, struct);
      const options = soft === null ? {} : { isNull: [soft] };
      const result = await read(pick(drv), struct, {}, options);
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
      const target = pick(drv);
      const hooks = hooksOf(this);
      const stamps = stampsOf(this);
      const casts = castsOf(this);
      const attrs = { ...(payload as Partial<Row>) };
      await runHooks(hooks, 'saving', context(attrs as Row, attrs as Partial<Row>));
      await runHooks(hooks, 'creating', context(attrs as Row, attrs as Partial<Row>));
      await runHooks(stamps, 'creating', live(attrs as Row, attrs as Partial<Row>));
      const stored = castIn(attrs as Record<string, unknown>, casts) as Partial<Row>;
      const result = await createRow(target, struct, stored as InsertOf<F>);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      const rowStored = { ...stored };
      if ((stored as Record<string, unknown>)[pk] === undefined && result.data.id !== undefined) {
        (rowStored as Record<string, unknown>)[pk] = result.data.id;
      }
      const row = castOut(rowStored as Record<string, unknown>, casts) as Row;
      const instance = this.hydrate(row as Row);
      await deliver(target, hooks, ['created', 'saved'], context(row as Row, attrs as Partial<Row>));
      return instance;
    }

    static query(drv?: Driver): QueryBuilder<Table, F> {
      const builder = query(pick(drv), struct);
      const soft = softColumnOf(this, struct);
      return soft === null ? builder : builder.softScope(soft);
    }

    /**
     * Unscoped reads including trashed rows. Restore and forceDelete stay
     * instance methods: find here, then act on what comes back.
     */
    static withTrashed<T extends Model>(
      this: new (data?: Partial<Row>) => T,
    ): ScopedReads<Table, F, T> {
      const ctor = this as (new (data?: Partial<Row>) => T) & { hydrate(row: Row): T };
      return {
        async find(id: BindValue, drv?: Driver): Promise<T | null> {
          const result = await readOne(pick(drv), struct, { [pk]: id } as Partial<Row>);
          if (!result.success) {
            throw new Error(failMessage(result.message, result.errors));
          }
          return result.data === null ? null : ctor.hydrate(result.data);
        },
        async findOrFail(id: BindValue, drv?: Driver): Promise<T> {
          return ctor.hydrate(await findOrFailRow(pick(drv), struct, key, id));
        },
        async all(drv?: Driver): Promise<T[]> {
          const result = await read(pick(drv), struct, {}, {});
          if (!result.success) {
            throw new Error(failMessage(result.message, result.errors));
          }
          return result.data.map((row) => ctor.hydrate(row));
        },
        query(drv?: Driver): QueryBuilder<Table, F> {
          return query(pick(drv), struct);
        },
      };
    }

    static async deleteWhere(
      conditions: Partial<Row>,
      drv?: Driver,
    ): Promise<{ affectedRows: number }> {
      const target = pick(drv);
      const soft = softColumnOf(this, struct);
      const stored = castIn({ ...(conditions as Record<string, unknown>) }, castsOf(this));
      if (soft === null) {
        let builder = query(target, struct);
        for (const name of Object.keys(stored)) {
          builder = builder.where(name as keyof F & string, (stored as Record<string, unknown>)[name] as BindValue);
        }
        const result = await builder.delete();
        if (!result.success) {
          throw new Error(failMessage(result.message, result.errors));
        }
        return result.data;
      }
      // Bulk soft path: stamp matches, skip trashed, fire no hooks.
      const stamped = castIn({ [soft]: softStamp() }, castsOf(this))[soft] as BindValue;
      const { sql, params } = buildSoftUpdate(target.dialect, struct, soft, stamped, stored);
      const result = await target.execute(sql, params);
      return { affectedRows: result.affectedRows };
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
        if (!valuesEqual(current, base)) {
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
      const hooks = hooksOf(this.constructor);
      const stamps = stampsOf(this.constructor);
      const casts = castsOf(this.constructor);
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        await runHooks(hooks, 'saving', live(this.attributes, this.attributes));
        await runHooks(hooks, 'creating', live(this.attributes, this.attributes));
        await runHooks(stamps, 'creating', live(this.attributes, this.attributes));
        const stored = castIn({ ...(this.attributes as Record<string, unknown>) }, casts);
        const result = await createRow(target, struct, stored as InsertOf<F>);
        if (!result.success) {
          throw new Error(failMessage(result.message, result.errors));
        }
        if ((stored as Record<string, unknown>)[pk] === undefined && result.data.id !== undefined) {
          (stored as Record<string, unknown>)[pk] = result.data.id;
        }
        this.attributes = castOut(stored, casts) as Row;
        this.original = { ...this.attributes };
        this.lastAffectedRows = 1;
        await deliver(target, hooks, ['created', 'saved'], context(this.attributes, this.attributes));
        return this;
      }
      if (!this.isDirty()) {
        return this;
      }
      const pending = this.getChanges();
      await runHooks(hooks, 'saving', live(this.attributes, pending));
      await runHooks(hooks, 'updating', live(this.attributes, pending));
      await runHooks(stamps, 'updating', live(this.attributes, pending));
      const changes = this.getChanges();
      const storedChanges = castIn({ ...(changes as Record<string, unknown>) }, casts);
      const violations = validatePayload(struct.fields, storedChanges as Record<string, unknown>, {
        partial: true,
      });
      if (violations.length > 0) {
        throw new Error(failMessage('Validation failed', violations.map((v) => v.message)));
      }
      const { sql, params } = buildUpdate(target.dialect, struct, {
        ...(storedChanges as Record<string, unknown>),
        [pk]: id,
      }, pk);
      const written = await target.execute(sql, params);
      this.lastAffectedRows = written.affectedRows;
      this.original = { ...this.attributes };
      await deliver(target, hooks, ['updated', 'saved'], context(this.attributes, changes));
      return this;
    }

    async delete(drv?: Driver): Promise<{ affectedRows: number }> {
      const target = pick(drv);
      const hooks = hooksOf(this.constructor);
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        throw new Error('Cannot delete a model without a primary key value');
      }
      const soft = softColumnOf(this.constructor, struct);
      if (soft !== null) {
        if (isTrashed(this.attributes as Record<string, unknown>)) {
          this.lastAffectedRows = 0;
          return { affectedRows: 0 };
        }
        const casts = castsOf(this.constructor);
        const current = await freshRow(target, id);
        if (current !== null && isTrashed(current as Record<string, unknown>)) {
          this.attributes = castOut({ ...current }, casts) as Row;
          this.original = { ...this.attributes };
          this.lastAffectedRows = 0;
          return { affectedRows: 0 };
        }
        await runHooks(hooks, 'deleting', context(this.attributes, {}));
        const stamped = castIn({ [soft]: softStamp() }, casts)[soft];
        const { sql, params } = buildSoftUpdate(target.dialect, struct, soft, stamped as BindValue, {
          [pk]: id,
        });
        const written = await target.execute(sql, params);
        this.lastAffectedRows = written.affectedRows;
        if (written.affectedRows === 0) {
          const latest = await freshRow(target, id);
          if (latest !== null) {
            this.attributes = castOut({ ...latest }, casts) as Row;
            this.original = { ...this.attributes };
          }
          return { affectedRows: 0 };
        }
        this.attributes = castOut({ ...(this.attributes as Record<string, unknown>), [soft]: stamped }, casts) as Row;
        this.original = { ...this.attributes };
        await deliver(target, hooks, ['deleted'], context(this.attributes, {}));
        return { affectedRows: written.affectedRows };
      }
      await runHooks(hooks, 'deleting', context(this.attributes, {}));
      const result = await remove(target, struct, key, id);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      this.lastAffectedRows = result.data.affectedRows;
      await deliver(target, hooks, ['deleted'], context(this.attributes, {}));
      return { affectedRows: result.data.affectedRows };
    }

    async restore(drv?: Driver): Promise<this> {
      const target = pick(drv);
      const hooks = hooksOf(this.constructor);
      const soft = softColumnOf(this.constructor, struct);
      if (soft === null) {
        throw new Error('restore requires soft deletes: set static softDeletes');
      }
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        throw new Error('Cannot restore a model without a primary key value');
      }
      if (!isTrashed(this.attributes as Record<string, unknown>)) {
        this.lastAffectedRows = 0;
        return this;
      }
      const current = await freshRow(target, id);
      if (current !== null && !isTrashed(current as Record<string, unknown>)) {
        this.attributes = castOut({ ...current }, castsOf(this.constructor)) as Row;
        this.original = { ...this.attributes };
        this.lastAffectedRows = 0;
        return this;
      }
      await runHooks(hooks, 'restoring', context(this.attributes, { [soft]: null } as Partial<Row>));
      const { sql, params } = buildSoftRestore(target.dialect, struct, soft, { [pk]: id });
      const written = await target.execute(sql, params);
      this.lastAffectedRows = written.affectedRows;
      if (written.affectedRows === 0) {
        const latest = await freshRow(target, id);
        if (latest !== null) {
          this.attributes = castOut({ ...latest }, castsOf(this.constructor)) as Row;
          this.original = { ...this.attributes };
        }
        return this;
      }
      (this.attributes as Record<string, unknown>)[soft] = null;
      this.original = { ...this.attributes };
      await deliver(target, hooks, ['restored'], context(this.attributes, {}));
      return this;
    }

    async forceDelete(drv?: Driver): Promise<{ affectedRows: number }> {
      const target = pick(drv);
      const hooks = hooksOf(this.constructor);
      const soft = softColumnOf(this.constructor, struct);
      if (soft === null) {
        throw new Error('forceDelete requires soft deletes: set static softDeletes');
      }
      const id = (this.attributes as Record<string, unknown>)[pk] as BindValue | undefined;
      if (id === undefined || id === null) {
        throw new Error('Cannot delete a model without a primary key value');
      }
      await runHooks(hooks, 'forceDeleting', context(this.attributes, {}));
      const result = await remove(target, struct, key, id);
      if (!result.success) {
        throw new Error(failMessage(result.message, result.errors));
      }
      this.lastAffectedRows = result.data.affectedRows;
      await deliver(target, hooks, ['forceDeleted'], context(this.attributes, {}));
      return { affectedRows: result.data.affectedRows };
    }
  }

  return Model as unknown as ModelStatic<Table, F>;
}
