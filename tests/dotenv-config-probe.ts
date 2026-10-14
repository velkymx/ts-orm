/** Dotenv probe: config.ts alone must trigger the load, no pool module. */
import { resolveConfig } from '../src/config.js';

console.log(JSON.stringify(resolveConfig()));
