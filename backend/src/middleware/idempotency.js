import crypto from 'crypto';
import { query } from '../config/db.js';
import {
  IdempotencyKeyReusedError,
  IdempotencyInProgressError,
  ValidationError,
} from '../errors/AppError.js';
import logger from '../config/logger.js';

/**
 * Produces a deterministic canonical JSON string by sorting object keys recursively.
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + canonicalJsonStringify(obj[key])
  );
  return '{' + pairs.join(',') + '}';
}

export function computeCanonicalHash(body) {
  return crypto.createHash('sha256').update(canonicalJsonStringify(body || {})).digest('hex');
}

/**
 * Reaps orphaned 'processing' idempotency keys older than the threshold (default 60 seconds).
 */
export async function reapStaleProcessingKeys(maxAgeSeconds = 60) {
  try {
    await query(
      `
      DELETE FROM idempotency_keys
      WHERE status = 'processing'
        AND created_at < clock_timestamp() - ($1 || ' seconds')::INTERVAL;
      `,
      [maxAgeSeconds]
    );
  } catch (err) {
    logger.warn({ err }, 'Error running idempotency stale reaper');
  }
}

export function requireIdempotencyKey(req, res, next) {
  const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  if (!key || typeof key !== 'string' || !key.trim()) {
    return next(new ValidationError('Idempotency-Key header is required for this operation.'));
  }
  next();
}

export function idempotency(options = { required: true }) {
  return async (req, res, next) => {
    const rawKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];

    if (!rawKey) {
      if (options.required) {
        return next(new ValidationError('Idempotency-Key header is required for this operation.'));
      }
      return next();
    }

    const trimmedKey = String(rawKey).trim();
    const userId = req.user?.id || null;
    const requestPath = req.baseUrl + req.path;
    const requestMethod = req.method;
    const requestHash = computeCanonicalHash(req.body);

    // Opportunistically reap stale processing keys older than 60s
    await reapStaleProcessingKeys(60);

    try {
      // 1. Attempt to insert key in 'processing' state scoped by (user_id, method, path, key)
      const insertSql = `
        INSERT INTO idempotency_keys (
          user_id, idempotency_key, request_path, request_method, request_hash,
          status, response_status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 'processing', 0, clock_timestamp() + INTERVAL '24 hours')
        ON CONFLICT ON CONSTRAINT uq_idempotency_scope DO NOTHING
        RETURNING id;
      `;

      const insertRes = await query(insertSql, [
        userId,
        trimmedKey,
        requestPath,
        requestMethod,
        requestHash,
      ]);

      if (insertRes.rows.length > 0) {
        const recordId = insertRes.rows[0].id;
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);

        // Intercept response and AWAIT the completion update
        res.json = async function (body) {
          res.json = originalJson; // Restore
          const statusCode = res.statusCode || 200;

          try {
            if (statusCode < 500) {
              await query(
                `
                UPDATE idempotency_keys
                SET status = 'completed',
                    response_status = $2,
                    response_body = $3
                WHERE id = $1;
                `,
                [recordId, statusCode, JSON.stringify(body)]
              );
            } else {
              // On internal error (500), release the key so client may retry
              await query('DELETE FROM idempotency_keys WHERE id = $1;', [recordId]);
            }
          } catch (updateErr) {
            logger.error({ updateErr, recordId }, 'Failed to record idempotency completion');
          }

          res.setHeader('Content-Type', 'application/json');
          return originalSend.call(this, JSON.stringify(body));
        };

        return next();
      }

      // 2. Key already exists in database - fetch record
      const existingRes = await query(
        `
        SELECT * FROM idempotency_keys
        WHERE idempotency_key = $1
          AND ($2::uuid IS NULL OR user_id = $2::uuid)
          AND request_path = $3
          AND request_method = $4
        LIMIT 1;
        `,
        [trimmedKey, userId, requestPath, requestMethod]
      );

      if (existingRes.rows.length === 0) {
        // Key exists under different scope/path
        return next(
          new IdempotencyKeyReusedError(
            'Idempotency key was previously used in a different endpoint or context.'
          )
        );
      }

      const record = existingRes.rows[0];

      // Verify request payload hash
      if (record.request_hash !== requestHash) {
        return next(
          new IdempotencyKeyReusedError(
            'Idempotency key was previously used with a different request payload'
          )
        );
      }

      // Check if still processing
      if (record.status === 'processing') {
        return next(
          new IdempotencyInProgressError(
            'A request with this idempotency key is currently being processed. Please retry shortly.'
          )
        );
      }

      // Return stored response
      res.setHeader('X-Cache-Lookup', 'HIT-IDEMPOTENT');
      return res.status(record.response_status).json(record.response_body);
    } catch (err) {
      next(err);
    }
  };
}

export default {
  idempotency,
  requireIdempotencyKey,
  canonicalJsonStringify,
  computeCanonicalHash,
  reapStaleProcessingKeys,
};
