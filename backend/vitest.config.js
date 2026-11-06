import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/setup.js',
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test',
    },
    testTimeout: 25000,
    hookTimeout: 25000,
    globals: true,
  },
});
