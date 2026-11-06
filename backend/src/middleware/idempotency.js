import crypto from 'crypto';
import { query } from '../config/db.js';
import {
  IdempotencyKeyReusedError,
  IdempotencyInProgressError,
  ValidationError,
} from '../errors/AppError.js';
import logger from '../config/logger.js';

export function requireIdempotencyKey(req, res, next) {
  const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  if (!key || typeof key !== 'string' || !key.trim()) {
    return next(new ValidationError('Idempotency-Key header is required for this operation.'));
  }
  next();
}

export function idempotency(options = { required: true }) {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];

    if (!key) {
      if (options.required) {
        return next(new ValidationError('Idempotency-Key header is required for this operation.'));
      }
      return next();
    }

    const trimmedKey = String(key).trim();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(req.body || {}))
      .digest('hex');

    try {
      // 1. Attempt to insert key in 'processing' state
      const insertSql = `
        INSERT INTO idempotency_keys (
          idempotency_key, request_path, request_method, request_hash,
          status, response_status, expires_at
        )
        VALUES ($1, $2, $3, $4, 'processing', 0, clock_timestamp() + INTERVAL '24 hours')
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id;
      `;

      const insertRes = await query(insertSql, [
        trimmedKey,
        req.baseUrl + req.path,
        req.method,
        requestHash,
      ]);

      if (insertRes.rows.length > 0) {
        // We are the primary request processor. Intercept response to store result.
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);

        res.json = (body) => {
          res.json = originalJson; // Restore
          const statusCode = res.statusCode || 200;

          // Only store success or client error responses (don't lock on 500 server crashes)
          if (statusCode < 500) {
            query(
              `
              UPDATE idempotency_keys
              SET status = 'completed',
                  response_status = $2,
                  response_body = $3
              WHERE idempotency_key = $1;
              `,
              [trimmedKey, statusCode, JSON.stringify(body)]
            ).catch((err) => {
              logger.error({ err, key: trimmedKey }, 'Failed to record idempotency completion');
            });
          } else {
            // Remove key so client can retry after server crash
            query('DELETE FROM idempotency_keys WHERE idempotency_key = $1;', [trimmedKey]).catch(
              () => {}
            );
          }

          return originalJson(body);
        };

        return next();
      }

      // 2. Key already exists in database
      const existingRes = await query(
        'SELECT * FROM idempotency_keys WHERE idempotency_key = $1 LIMIT 1;',
        [trimmedKey]
      );

      if (existingRes.rows.length === 0) {
        return next();
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
};
