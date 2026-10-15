/** Dotenv probe: library import must resolve config from .env alone. */
import { resolveConfig } from '../src/index.js';

const { password, ...rest } = resolveConfig();
console.log(JSON.stringify({ ...rest, hasPassword: password.length > 0 }));
