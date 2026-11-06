import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import logger from '../config/logger.js';

export function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';

  // 1. Zod Validation Errors
  if (err instanceof ZodError) {
    const fieldDetails = {};
    for (const issue of err.issues) {
      const field = issue.path.join('.') || 'body';
      fieldDetails[field] = issue.message;
    }

    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request input data',
        details: fieldDetails,
        requestId,
      },
    });
  }

  // 2. Custom Application Errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details || {},
        requestId,
      },
    });
  }

  // 3. PostgreSQL Exclusion Constraint Violation (SQLSTATE 23P01)
  if (err.code === '23P01') {
    return res.status(409).json({
      error: {
        code: 'SLOT_TAKEN',
        message: 'The requested appointment slot is already booked for this doctor',
        details: { constraint: err.constraint },
        requestId,
      },
    });
  }

  // 4. PostgreSQL Unique Constraint Violation (SQLSTATE 23505)
  if (err.code === '23505') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with the specified unique field already exists',
        details: { detail: err.detail },
        requestId,
      },
    });
  }

  // 5. PostgreSQL Audit Append-Only Trigger Violation (SQLSTATE 55000)
  if (err.code === '55000') {
    return res.status(403).json({
      error: {
        code: 'AUDIT_IMMUTABLE',
        message: err.message || 'Audit log entries cannot be modified or deleted',
        details: {},
        requestId,
      },
    });
  }

  // 6. Generic Internal Server Errors
  logger.error({ err, requestId }, 'Unhandled Application Error');

  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected internal error occurred'
      : err.message || 'Internal Server Error';

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      details: {},
      requestId,
    },
  });
}

export default errorHandler;
