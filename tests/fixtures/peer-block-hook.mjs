/**
 * Resolve hook for the peer-absence probe. Fails pg and mssql like an
 * install without optional peers; everything else resolves normally.
 */
export async function resolve(specifier, context, next) {
  if (specifier === 'pg' || specifier === 'mssql') {
    throw Object.assign(new Error(`Cannot find package '${specifier}'`), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
  }
  return next(specifier, context);
}
