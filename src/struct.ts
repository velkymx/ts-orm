/**
 * The struct primitive: a single self-documenting schema declaration that
 * drives row types, validation, SQL generation, and introspection.
 *
 * Declare once (Go-struct style); the row/insert/update shapes are inferred,
 * never redeclared, so types and runtime can never drift.
 */

export type FieldType =
  | 'number'
  | 'string'
  | 'uuid'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum';

/** One column definition. Options act as inline "struct tags" documenting intent. */
export interface FieldDef {
  readonly type: FieldType;
  readonly required?: boolean;
  readonly length?: number;
  readonly default?: string | null;
  readonly enum?: readonly string[];
}

/** A map of column name to its definition. */
export type Fields = Record<string, FieldDef>;

/** Bound struct: table name + field map, carrying inferred types for consumers. */
export interface Struct<Table extends string, F extends Fields> {
  readonly table: Table;
  readonly fields: F;
}

/** Flatten intersections into a single object type for clean inference output. */
type Simplify<T> = { [K in keyof T]: T[K] };

/** Scalar TS type a single field resolves to (enum widens to its literal union). */
export type ScalarOf<F extends FieldDef> = F extends { readonly enum: readonly (infer E)[] }
  ? E
  : F['type'] extends 'number'
    ? number
    : F['type'] extends 'boolean'
      ? boolean
      : string;

type RequiredRowKeys<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly required: true } ? K : never;
}[keyof F];

type OptionalRowKeys<F extends Fields> = Exclude<keyof F, RequiredRowKeys<F>>;

/** The full row shape: required columns are required, the rest optional. */
export type RowOf<F extends Fields> = Simplify<
  {
    [K in RequiredRowKeys<F>]: ScalarOf<F[K]>;
  } & {
    [K in OptionalRowKeys<F>]?: ScalarOf<F[K]>;
  }
>;

type AutoIncrementKeys<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly default: 'auto_increment' } ? K : never;
}[keyof F];

type DefaultedKeys<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly default: string } ? K : never;
}[keyof F];

type InsertableKeys<F extends Fields> = Exclude<keyof F, AutoIncrementKeys<F>>;

type InsertRequiredKeys<F extends Fields> = Exclude<
  RequiredRowKeys<F> & InsertableKeys<F>,
  DefaultedKeys<F>
>;

type InsertOptionalKeys<F extends Fields> = Exclude<
  InsertableKeys<F>,
  InsertRequiredKeys<F>
>;

/** Insert payload: auto_increment omitted, DB-defaulted columns optional. */
export type InsertOf<F extends Fields> = Simplify<
  {
    [K in InsertRequiredKeys<F>]: ScalarOf<F[K]>;
  } & {
    [K in InsertOptionalKeys<F>]?: ScalarOf<F[K]>;
  }
>;

/** Update payload: every column optional (partial update). */
export type UpdateOf<F extends Fields> = Simplify<Partial<RowOf<F>>>;

/**
 * Declare a struct. The `const` type parameter preserves literal field types
 * (so enums infer as unions) without requiring `as const` at the call site.
 */
export function defineStruct<Table extends string, const F extends Fields>(
  table: Table,
  fields: F,
): Struct<Table, F> {
  const frozen: Record<string, FieldDef> = {};
  for (const name of Object.keys(fields)) {
    const def = fields[name] as FieldDef;
    frozen[name] = Object.freeze({
      ...def,
      ...(def.enum === undefined ? {} : { enum: Object.freeze([...def.enum]) }),
    });
  }
  return { table, fields: Object.freeze(frozen) as F };
}
