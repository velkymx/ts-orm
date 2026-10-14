/** Dotenv probe: library import must resolve config from .env alone. */
import { resolveConfig } from '../src/index.js';

console.log(JSON.stringify(resolveConfig()));
