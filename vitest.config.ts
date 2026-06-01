import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Provide describe/test/expect/beforeAll/afterAll as globals so the existing
    // Jest-style test files run under Vitest with zero per-test rewrites.
    globals: true,
    // Boot one ephemeral MySQL once for the whole run; see tests/setup/global.ts.
    globalSetup: './tests/setup/global.ts',
    // Single forked worker: the DB connection env that globalSetup writes into
    // process.env is inherited by the (one) forked child, and the module-level
    // mysql2 pools read that env at import time. Multiple workers would each get
    // their own process and race the shared schema, so we serialize to one.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['tests/**/*.test.{mjs,ts}'],
    // First DB op after boot can be slow; give hooks/tests room.
    testTimeout: 30000,
    hookTimeout: 120000,
    // Coverage gate. Thresholds are set at the current audited baseline so the
    // suite fails on regression; raise them as A2 lands missing tests.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 65,
        functions: 70,
        branches: 63,
        statements: 65
      }
    }
  },
});
