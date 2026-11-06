import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(customDbUrl = null) {
  const connectionString =
    customDbUrl ||
    (process.env.NODE_ENV === 'test'
      ? process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test'
      : process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms');

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
    `);

    // Fetch applied migrations
    const res = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
    const applied = new Set(res.rows.map((r) => r.version));

    // Read migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[Migrate] No migrations directory found at', migrationsDir);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      const version = file.split('_')[0];
      if (applied.has(version)) {
        continue;
      }

      console.log(`[Migrate] Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      const start = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, file]
        );
        await client.query('COMMIT');
        appliedCount++;
        console.log(`[Migrate] Applied ${file} successfully in ${Date.now() - start}ms`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migrate] Failed to apply ${file}:`, err.message);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('[Migrate] Database is already up to date. No new migrations.');
    } else {
      console.log(`[Migrate] Successfully applied ${appliedCount} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

// Execute directly if run as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migrate] Migration failed:', err);
      process.exit(1);
    });
}
