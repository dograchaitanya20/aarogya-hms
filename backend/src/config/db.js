import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Ensure BIGINT (OID 20) is parsed without precision loss (as string or BigInt)
pg.types.setTypeParser(20, (val) => (val === null ? null : val));

const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test'
    : process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms';

export const pool = new pg.Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export const endPool = () => pool.end();

export default {
  pool,
  query,
  getClient,
  endPool,
};
