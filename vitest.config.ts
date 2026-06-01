import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Provide describe/test/expect/beforeAll/afterAll as globals so the existing
    // Jest-style test files run under Vitest with zero per-test rewrites.
    globals: true,
    // Boot one ephemeral MySQL once for the whole run; see tests/setup/global.ts.
    globalSetup: './tests/setup/global.ts',
    // Run test files sequentially in forks. globalSetup writes the DB connection
    // into process.env before any worker is forked, so each child inherits it and
    // the module-level mysql2 pools pick it up at import. Sequential execution
    // keeps per-file schema setup/teardown from interleaving. (Vitest 4 removed
    // poolOptions; fileParallelism is the top-level replacement.)
    pool: 'forks',
    fileParallelism: false,
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
        lines: 85,
        functions: 95,
        branches: 76,
        statements: 85
      }
    }
  },
});
