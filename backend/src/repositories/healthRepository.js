import { query } from '../config/db.js';

// Cheapest possible round trip, used by the health endpoint
export async function ping() {
  await query('SELECT 1');
}

export default { ping };
