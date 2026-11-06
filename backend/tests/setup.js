import dotenv from 'dotenv';
import { runMigrations } from '../db/migrate.js';
import { runSeed } from '../db/seed.js';

dotenv.config();

export async function setup() {
  process.env.NODE_ENV = 'test';
  const testDbUrl = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test';
  process.env.TEST_DATABASE_URL = testDbUrl;

  console.log('[Test Setup] Ensuring test database is migrated and seeded...');
  await runMigrations(testDbUrl);
  await runSeed(testDbUrl);
  console.log('[Test Setup] Test database ready.');
}
