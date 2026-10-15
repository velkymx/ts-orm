/** Dotenv probe: config.ts alone must trigger the load, no pool module. */
import { resolveConfig } from '../src/config.js';

const { password, ...rest } = resolveConfig();
console.log(JSON.stringify({ ...rest, hasPassword: password.length > 0 }));
