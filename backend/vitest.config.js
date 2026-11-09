import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/setup.js',
    env: {
      NODE_ENV: 'test',
      // Test-only secret (never used by the real app); keeps env.js free of any hardcoded fallback
      JWT_SECRET: 'vitest-only-secret-never-used-outside-tests-0123456789',
      TEST_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test',
    },
    testTimeout: 25000,
    hookTimeout: 25000,
    globals: true,
  },
});
