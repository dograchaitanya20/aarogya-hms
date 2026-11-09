import { query } from '../config/db.js';

// Inserts the key in 'processing' state. Returns the new row id, or null when the key already exists
// for this (user, method, path). Doing the INSERT first is what stops concurrent duplicates from both running.
export async function tryStart({ userId, key, requestPath, requestMethod, requestHash }) {
  const result = await query(
    `INSERT INTO idempotency_keys (
       user_id, idempotency_key, request_path, request_method, request_hash,
       status, response_status, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, 'processing', 0, clock_timestamp() + INTERVAL '24 hours')
     ON CONFLICT ON CONSTRAINT uq_idempotency_scope DO NOTHING
     RETURNING id`,
    [userId, key, requestPath, requestMethod, requestHash]
  );
  return result.rows[0]?.id || null;
}

export async function findByScope({ userId, key, requestPath, requestMethod }) {
  const result = await query(
    `SELECT * FROM idempotency_keys
     WHERE idempotency_key = $1
       AND ($2::uuid IS NULL OR user_id = $2::uuid)
       AND request_path = $3
       AND request_method = $4
     LIMIT 1`,
    [key, userId, requestPath, requestMethod]
  );
  return result.rows[0] || null;
}

export async function complete(id, responseStatus, responseBody) {
  await query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = $2, response_body = $3
     WHERE id = $1`,
    [id, responseStatus, JSON.stringify(responseBody)]
  );
}

// On a 5xx the key is released so the client may safely retry
export async function release(id) {
  await query('DELETE FROM idempotency_keys WHERE id = $1', [id]);
}

// Orphaned 'processing' rows (the request died mid-flight) would otherwise block retries forever
export async function reapStale(maxAgeSeconds) {
  await query(
    `DELETE FROM idempotency_keys
     WHERE status = 'processing' AND created_at < clock_timestamp() - make_interval(secs => $1)`,
    [maxAgeSeconds]
  );
}

export default { tryStart, findByScope, complete, release, reapStale };
