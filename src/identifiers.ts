/**
 * SQL identifier safety. Table and column names can never be bound as
 * parameters, so they are the one injection surface. Every identifier passes
 * an allowlist and is quoted, then carries a `SafeIdentifier` brand so the SQL
 * builders accept nothing a raw user string could reach.
 */

declare const safeIdentifierBrand: unique symbol;

/** A validated, backtick-quoted identifier. Only this module can mint one. */
export type SafeIdentifier = string & { readonly [safeIdentifierBrand]: true };

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]+$/;
const QUALIFIED_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/;

/** True when the value is a bare identifier of only letters, digits, underscore. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

/** True when the value is a `table.column` pair of two bare identifiers. */
export function isQualifiedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && QUALIFIED_IDENTIFIER_PATTERN.test(value);
}

/**
 * Validate a bare identifier and return it backtick-quoted and branded.
 * The allowlist guarantees no backtick is present, so quoting cannot be broken.
 */
export function safeIdentifier(value: string, context = 'identifier'): SafeIdentifier {
  if (!isIdentifier(value)) {
    throw new Error(
      `Invalid ${context}: identifiers may contain only letters, digits, and underscore`,
    );
  }
  return `\`${value}\`` as SafeIdentifier;
}

/** Validate a `table.column` identifier and return both halves quoted and branded. */
export function safeQualified(value: string, context = 'identifier'): SafeIdentifier {
  if (!isQualifiedIdentifier(value)) {
    throw new Error(`Invalid qualified ${context}: expected table.column`);
  }
  const dot = value.indexOf('.');
  const table = value.slice(0, dot);
  const column = value.slice(dot + 1);
  return `\`${table}\`.\`${column}\`` as SafeIdentifier;
}
