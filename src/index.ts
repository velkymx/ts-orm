// Backward compatible exports - existing API
export * from './orm.js';
export { validatePayload } from './validator.js';

// New enhanced API
export { model } from './model.js';
export { QueryBuilder } from './QueryBuilder.js';

// Shared types for consumers
export type { Field, FieldType, ValidateOptions } from './validator.js';
export type { OrmResponse } from './QueryBuilder.js';
