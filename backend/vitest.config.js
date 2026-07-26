import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/support/setupEnv.js'],
    testTimeout: 15000,
    hookTimeout: 20000,
    // Role-authorization tests share one fixture org/person set per role
    // (created once in a global beforeAll) — running files in parallel
    // workers would race concurrent setup/teardown against the same rows.
    fileParallelism: false,
  },
});
