import http from 'node:http';

// Runs once in the main Node process (not in jsdom): prepares the test database, then serves the real API.
export default async function setup({ provide }) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'vitest-only-secret-never-used-outside-tests-0123456789';
  process.env.TEST_DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test';

  const { setup: prepareDatabase } = await import('../../backend/tests/setup.js');
  await prepareDatabase();

  const { default: app } = await import('../../backend/src/app.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  provide('apiUrl', `http://127.0.0.1:${port}`);
  console.log(`[Frontend tests] real API listening on :${port}`);

  return async () => {
    await new Promise((resolve) => server.close(resolve));
    const { pool } = await import('../../backend/src/config/db.js');
    await pool.end();
  };
}
