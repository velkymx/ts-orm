/**
 * Relations plus batched eager loading. A relation binds two structs with
 * the key columns that connect them, then load resolves many parents in a
 * constant number of queries (one, two for pivot joins) by collecting keys
 * and issuing a single WHERE IN per table. All reads reuse the query
 * builder, so identifier validation plus bound values hold everywhere.
 * deleteRelated removes dependent rows with the builder delete primitive,
 * which is what keeps polymorphic children from orphaning.
 */

import { buildSoftUpdate, primaryKey } from './crud.js';
import type { BindValue, Driver } from './driver.js';
import { timestampNow } from './lifecycle.js';
import type { ModelInstance } from './model.js';
import { query, type QueryBuilder } from './query.js';
import type { Result } from './result.js';
import { SOFT_COLUMN, hasSoftColumn, requireSoftColumn } from './soft.js';
import type { Fields, RowOf, Struct } from './struct.js';

/** Relation shapes. Source rows go in, target rows come out keyed. */
export type RelationKind = 'hasOne' | 'hasMany' | 'belongsTo' | 'belongsToMany' | 'morphMany';

interface Base<ST extends string, SF extends Fields, TT extends string, TF extends Fields> {
  readonly kind: RelationKind;
  readonly source: Struct<ST, SF>;
  readonly target: Struct<TT, TF>;
}

export interface HasOne<ST extends string, SF extends Fields, TT extends string, TF extends Fields>
  extends Base<ST, SF, TT, TF> {
  readonly kind: 'hasOne';
  readonly foreignKey: keyof TF & string;
  readonly localKey: keyof SF & string;
}

export interface HasMany<ST extends string, SF extends Fields, TT extends string, TF extends Fields>
  extends Base<ST, SF, TT, TF> {
  readonly kind: 'hasMany';
  readonly foreignKey: keyof TF & string;
  readonly localKey: keyof SF & string;
}

export interface BelongsTo<ST extends string, SF extends Fields, TT extends string, TF extends Fields>
  extends Base<ST, SF, TT, TF> {
  readonly kind: 'belongsTo';
  readonly foreignKey: keyof SF & string;
  readonly ownerKey: keyof TF & string;
}

export interface BelongsToMany<
  ST extends string,
  SF extends Fields,
  TT extends string,
  TF extends Fields,
  PT extends string,
  PF extends Fields,
> extends Base<ST, SF, TT, TF> {
  readonly kind: 'belongsToMany';
  readonly pivot: Struct<PT, PF>;
  readonly foreignKey: keyof PF & string;
  readonly relatedKey: keyof PF & string;
  readonly localKey: keyof SF & string;
  readonly relatedLocalKey: keyof TF & string;
}

export interface MorphMany<ST extends string, SF extends Fields, TT extends string, TF extends Fields>
  extends Base<ST, SF, TT, TF> {
  readonly kind: 'morphMany';
  readonly idColumn: keyof TF & string;
  readonly typeColumn: keyof TF & string;
  readonly typeValue: string;
  readonly localKey: keyof SF & string;
}

export type Relation<ST extends string, SF extends Fields, TT extends string, TF extends Fields> =
  | HasOne<ST, SF, TT, TF>
  | HasMany<ST, SF, TT, TF>
  | BelongsTo<ST, SF, TT, TF>
  | BelongsToMany<ST, SF, TT, TF, string, Fields>
  | MorphMany<ST, SF, TT, TF>;

/** Loaded rows keyed by the join value, one array per key. */
export type Loaded<TF extends Fields> = Map<BindValue, RowOf<TF>[]>;

/** One-to-one child holding a foreign key to the source. */
export function hasOne<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  source: Struct<ST, SF>,
  target: Struct<TT, TF>,
  foreignKey: keyof TF & string,
  localKey?: keyof SF & string,
): HasOne<ST, SF, TT, TF> {
  return { kind: 'hasOne', source, target, foreignKey, localKey: localKey ?? (primaryKey(source.fields) as keyof SF & string) };
}

/** One-to-many children holding a foreign key to the source. */
export function hasMany<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  source: Struct<ST, SF>,
  target: Struct<TT, TF>,
  foreignKey: keyof TF & string,
  localKey?: keyof SF & string,
): HasMany<ST, SF, TT, TF> {
  return { kind: 'hasMany', source, target, foreignKey, localKey: localKey ?? (primaryKey(source.fields) as keyof SF & string) };
}

/** Owner pointed at by a foreign key on the source rows. */
export function belongsTo<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  source: Struct<ST, SF>,
  target: Struct<TT, TF>,
  foreignKey: keyof SF & string,
  ownerKey?: keyof TF & string,
): BelongsTo<ST, SF, TT, TF> {
  return { kind: 'belongsTo', source, target, foreignKey, ownerKey: ownerKey ?? (primaryKey(target.fields) as keyof TF & string) };
}

/** Many-to-many targets reached through pivot rows. */
export function belongsToMany<
  ST extends string,
  SF extends Fields,
  TT extends string,
  TF extends Fields,
  PT extends string,
  PF extends Fields,
>(
  source: Struct<ST, SF>,
  target: Struct<TT, TF>,
  pivot: Struct<PT, PF>,
  foreignKey: keyof PF & string,
  relatedKey: keyof PF & string,
  localKey?: keyof SF & string,
  relatedLocalKey?: keyof TF & string,
): BelongsToMany<ST, SF, TT, TF, PT, PF> {
  return {
    kind: 'belongsToMany',
    source,
    target,
    pivot,
    foreignKey,
    relatedKey,
    localKey: localKey ?? (primaryKey(source.fields) as keyof SF & string),
    relatedLocalKey: relatedLocalKey ?? (primaryKey(target.fields) as keyof TF & string),
  };
}

/** Polymorphic children sharing one table, scoped by a type column plus value. */
export function morphMany<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  source: Struct<ST, SF>,
  target: Struct<TT, TF>,
  idColumn: keyof TF & string,
  typeColumn: keyof TF & string,
  typeValue: string,
  localKey?: keyof SF & string,
): MorphMany<ST, SF, TT, TF> {
  return {
    kind: 'morphMany',
    source,
    target,
    idColumn,
    typeColumn,
    typeValue,
    localKey: localKey ?? (primaryKey(source.fields) as keyof SF & string),
  };
}

/** A parent key source: a plain row or a hydrated model instance. */
export type Parent<SF extends Fields> = Partial<RowOf<SF>> | ModelInstance<SF>;

/**
 * True for a hydrated model instance. Checks the full instance shape, not
 * just `attributes`, so a plain row with an `attributes` column never
 * unwraps by accident.
 */
function isModelInstance(value: unknown): value is { attributes: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { attributes?: unknown; original?: unknown; toRow?: unknown };
  return (
    typeof candidate.attributes === 'object' &&
    candidate.attributes !== null &&
    typeof candidate.original === 'object' &&
    candidate.original !== null &&
    typeof candidate.toRow === 'function'
  );
}

/** Read a parent key source as a plain row, unwrapping model instances. */
function parentRow(row: Record<string, unknown>): Record<string, unknown> {
  return isModelInstance(row) ? row.attributes : row;
}

/** Distinct non-null key values across the given rows. */
function keySet(rows: readonly Record<string, unknown>[], key: string): BindValue[] {
  const seen = new Set<BindValue>();
  for (const row of rows) {
    const value = row[key] as BindValue | undefined;
    if (value !== undefined && value !== null && !seen.has(value)) {
      seen.add(value);
    }
  }
  return [...seen];
}

function rowsOf<T>(result: Result<T[]>, operation: string): T[] {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.errors.join(', ')}`);
  }
  return result.data;
}

/** Options for relation loads. */
export interface LoadOptions {
  /** Include soft deleted target rows. Defaults to hiding them. */
  readonly withTrashed?: boolean;
}

/**
 * Start a target query with the soft scope applied when the target struct
 * declares the column. Pivot tables never scope: links are not entities.
 * The predicate names only the target table, so sibling tables never leak.
 */
function scoped<TT extends string, TF extends Fields>(
  driver: Driver,
  target: Struct<TT, TF>,
  opts?: LoadOptions,
): QueryBuilder<TT, TF> {
  const builder = query(driver, target);
  if (opts?.withTrashed !== true && hasSoftColumn(target)) {
    builder.softScope(SOFT_COLUMN);
  }
  return builder;
}

/**
 * Eager load one relation for many parents, mapping each join value to its
 * rows (empty array when none). Runs one query, two across a pivot, none
 * for no parents or no keys. Soft deleted targets stay hidden unless
 * withTrashed is set.
 */
export async function load<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  driver: Driver,
  rel: Relation<ST, SF, TT, TF>,
  parents: readonly Parent<SF>[],
  opts?: LoadOptions,
): Promise<Loaded<TF>> {
  const out: Loaded<TF> = new Map();
  if (parents.length === 0) {
    return out;
  }
  const rows = (parents as readonly Record<string, unknown>[]).map(parentRow);

  switch (rel.kind) {
    case 'hasOne':
    case 'hasMany': {
      const target = rel.target as Struct<string, Fields>;
      const keys = keySet(rows, rel.localKey as string);
      if (keys.length > 0) {
        const children = rowsOf(await scoped(driver, target, opts).whereIn(rel.foreignKey as string, keys).get(), 'load');
        const grouped = new Map<BindValue, Record<string, unknown>[]>();
        for (const key of keys) {
          grouped.set(key, []);
        }
        for (const child of children) {
          const record = child as unknown as Record<string, unknown>;
          grouped.get(record[rel.foreignKey as string] as BindValue)?.push(record);
        }
        for (const [key, list] of grouped) {
          out.set(key, list as RowOf<TF>[]);
        }
      }
      return out;
    }
    case 'belongsTo': {
      const keys = keySet(rows, rel.foreignKey as string);
      if (keys.length > 0) {
        const owners = rowsOf(await scoped(driver, rel.target, opts).whereIn(rel.ownerKey, keys).get(), 'load');
        for (const owner of owners) {
          const key = (owner as Record<string, unknown>)[rel.ownerKey as string] as BindValue;
          const list = out.get(key);
          if (list) {
            list.push(owner);
          } else {
            out.set(key, [owner]);
          }
        }
      }
      return out;
    }
    case 'belongsToMany': {
      const keys = keySet(rows, rel.localKey as string);
      if (keys.length > 0) {
        const links = rowsOf(await query(driver, rel.pivot).whereIn(rel.foreignKey, keys).get(), 'load pivot');
        const targets = rowsOf(
          await scoped(driver, rel.target, opts).whereIn(rel.relatedLocalKey, [
            ...new Set(links.map((l) => (l as Record<string, unknown>)[rel.relatedKey as string] as BindValue)),
          ]).get(),
          'load targets',
        );
        const byTarget = new Map<BindValue, RowOf<TF>>();
        for (const target of targets) {
          byTarget.set((target as Record<string, unknown>)[rel.relatedLocalKey as string] as BindValue, target);
        }
        for (const key of keys) {
          out.set(key, []);
        }
        for (const link of links) {
          const record = link as Record<string, unknown>;
          const target = byTarget.get(record[rel.relatedKey as string] as BindValue);
          if (target !== undefined) {
            const bucket = out.get(record[rel.foreignKey as string] as BindValue);
            if (bucket) bucket.push(target);
          }
        }
      }
      return out;
    }
    case 'morphMany': {
      const keys = keySet(rows, rel.localKey as string);
      if (keys.length > 0) {
        const children = rowsOf(
          await scoped(driver, rel.target, opts)
            .where(rel.typeColumn, rel.typeValue)
            .whereIn(rel.idColumn, keys)
            .get(),
          'load',
        );
        for (const key of keys) {
          out.set(key, []);
        }
        for (const child of children) {
          const key = (child as Record<string, unknown>)[rel.idColumn as string] as BindValue;
          const bucket = out.get(key);
          if (bucket) bucket.push(child);
        }
      }
      return out;
    }
  }
}

/** Load one row for a hasOne or belongsTo relation, or null when absent. */
export async function loadOne<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  driver: Driver,
  rel: HasOne<ST, SF, TT, TF> | BelongsTo<ST, SF, TT, TF>,
  parent: Parent<SF>,
  opts?: LoadOptions,
): Promise<RowOf<TF> | null> {
  const key = rel.kind === 'hasOne' ? rel.localKey : rel.foreignKey;
  const value = parentRow(parent as Record<string, unknown>)[key as string] as BindValue | undefined;
  if (value === undefined || value === null) {
    return null;
  }
  if (rel.kind === 'hasOne') {
    const result = await scoped(driver, rel.target, opts).where(rel.foreignKey, value).first();
    if (!result.success) {
      throw new Error(`loadOne failed: ${result.errors.join(', ')}`);
    }
    return result.data;
  }
  const result = await scoped(driver, rel.target, opts).where(rel.ownerKey, value).first();
  if (!result.success) {
    throw new Error(`loadOne failed: ${result.errors.join(', ')}`);
  }
  return result.data;
}

/** How deleteRelated treats dependent rows. */
export type DeleteRelatedMode =
  /** Physically remove dependents (pivot links detach), the historical default. */
  | 'force'
  /** Stamp dependents, skipping already stamped ones; pivot links still detach. */
  | 'soft'
  /** Touch nothing and report zero. */
  | 'ignore';

/**
 * Delete dependent rows for the given parent keys in one statement per
 * table. Pivot kinds detach links only; belongsTo owns nothing and throws.
 * Mode force removes physically, soft stamps the delete column (throwing
 * when the child struct lacks it), ignore returns 0. Bulk either way:
 * no hooks fire. Returns the total affected rows.
 */
export async function deleteRelated<
  ST extends string,
  SF extends Fields,
  TT extends string,
  TF extends Fields,
>(
  driver: Driver,
  rel: Relation<ST, SF, TT, TF>,
  parentIds: readonly BindValue[],
  mode: DeleteRelatedMode = 'force',
): Promise<number> {
  if (parentIds.length === 0 || mode === 'ignore') {
    return 0;
  }
  if (mode === 'soft') {
    return softDeleteRelated(driver, rel, parentIds);
  }
  switch (rel.kind) {
    case 'hasOne':
    case 'hasMany': {
      const result = await query(driver, rel.target).whereIn(rel.foreignKey, [...parentIds]).delete();
      if (!result.success) {
        throw new Error(`deleteRelated failed: ${result.errors.join(', ')}`);
      }
      return result.data.affectedRows;
    }
    case 'morphMany': {
      const result = await query(driver, rel.target)
        .where(rel.typeColumn, rel.typeValue)
        .whereIn(rel.idColumn, [...parentIds])
        .delete();
      if (!result.success) {
        throw new Error(`deleteRelated failed: ${result.errors.join(', ')}`);
      }
      return result.data.affectedRows;
    }
    case 'belongsToMany': {
      const result = await query(driver, rel.pivot).whereIn(rel.foreignKey, [...parentIds]).delete();
      if (!result.success) {
        throw new Error(`deleteRelated failed: ${result.errors.join(', ')}`);
      }
      return result.data.affectedRows;
    }
    case 'belongsTo': {
      throw new Error('deleteRelated does not apply to belongsTo: the source owns no rows');
    }
  }
}

/**
 * Stamp dependent rows instead of removing them. Pivot links still detach
 * physically: shared targets must never vanish with one parent. Throws
 * when the child struct has no delete column.
 */
async function softDeleteRelated<ST extends string, SF extends Fields, TT extends string, TF extends Fields>(
  driver: Driver,
  rel: Relation<ST, SF, TT, TF>,
  parentIds: readonly BindValue[],
): Promise<number> {
  const ids = [...parentIds];
  switch (rel.kind) {
    case 'hasOne':
    case 'hasMany': {
      const column = requireSoftColumn(rel.target);
      const { sql, params } = buildSoftUpdate(driver.dialect, rel.target, column, timestampNow(), {}, {
        column: rel.foreignKey as string,
        values: ids,
      });
      return (await driver.execute(sql, params)).affectedRows;
    }
    case 'morphMany': {
      const column = requireSoftColumn(rel.target);
      const { sql, params } = buildSoftUpdate(
        driver.dialect,
        rel.target,
        column,
        timestampNow(),
        { [rel.typeColumn as string]: rel.typeValue },
        { column: rel.idColumn as string, values: ids },
      );
      return (await driver.execute(sql, params)).affectedRows;
    }
    case 'belongsToMany': {
      const result = await query(driver, rel.pivot).whereIn(rel.foreignKey, ids).delete();
      if (!result.success) {
        throw new Error(`deleteRelated failed: ${result.errors.join(', ')}`);
      }
      return result.data.affectedRows;
    }
    case 'belongsTo': {
      throw new Error('deleteRelated does not apply to belongsTo: the source owns no rows');
    }
  }
}
