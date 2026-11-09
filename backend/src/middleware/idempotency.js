import crypto from 'crypto';
import idempotencyRepository from '../repositories/idempotencyRepository.js';
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
    await idempotencyRepository.reapStale(maxAgeSeconds);
  } catch (err) {
    logger.warn({ err }, 'Error running idempotency stale reaper');
  }
}

// Background timer to periodically reap stale processing keys without blocking requests
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    reapStaleProcessingKeys(60).catch(() => {});
  }, 60000).unref();
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

    try {
      // 1. Insert the key in 'processing' state, scoped by (user_id, method, path, key)
      const recordId = await idempotencyRepository.tryStart({
        userId,
        key: trimmedKey,
        requestPath,
        requestMethod,
        requestHash,
      });

      if (recordId) {
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);

        // Intercept response and AWAIT the completion update
        res.json = async function (body) {
          res.json = originalJson; // Restore
          const statusCode = res.statusCode || 200;

          try {
            if (statusCode < 500) {
              await idempotencyRepository.complete(recordId, statusCode, body);
            } else {
              // On internal error (500), release the key so client may retry
              await idempotencyRepository.release(recordId);
            }
          } catch (updateErr) {
            logger.error({ updateErr, recordId }, 'Failed to record idempotency completion');
          }

          res.setHeader('Content-Type', 'application/json');
          return originalSend.call(this, JSON.stringify(body));
        };

        return next();
      }

      // 2. Key already exists in database (insert conflict). Run reaper only on conflict.
      await reapStaleProcessingKeys(60);

      const record = await idempotencyRepository.findByScope({
        userId,
        key: trimmedKey,
        requestPath,
        requestMethod,
      });

      if (!record) {
        // Key exists under different scope/path
        return next(
          new IdempotencyKeyReusedError(
            'Idempotency key was previously used in a different endpoint or context.'
          )
        );
      }

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
