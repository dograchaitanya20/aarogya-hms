import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to Vite (5173); /api is proxied to the Express API (5000).
// Same origin means the httpOnly session cookie "just works" and no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    // Starts the REAL Express API (and migrates/seeds the isolated test database) once for the whole run,
    // so the UI tests exercise real endpoints, not mocks.
    globalSetup: ['./tests/globalSetup.js'],
    css: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'vitest-only-secret-never-used-outside-tests-0123456789',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test',
    },
  },
});
