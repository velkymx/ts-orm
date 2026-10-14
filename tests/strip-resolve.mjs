/**
 * Resolve hook for the strip-types probe only. Maps relative `.js`
 * specifiers to sibling `.ts` files (the nodenext layout tsc documents),
 * retrying only after normal resolution fails. Transpiles nothing.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (
      typeof specifier === 'string' &&
      specifier.startsWith('.') &&
      specifier.endsWith('.js') &&
      error?.code === 'ERR_MODULE_NOT_FOUND'
    ) {
      return next(specifier.replace(/\.js$/, '.ts'), context);
    }
    throw error;
  }
}
