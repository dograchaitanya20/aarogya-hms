import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import logger from '../config/logger.js';

export function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';

  // 1. Zod Validation Errors (422)
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

  // Payload Too Large (413) from Express body-parser
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds the maximum allowed size (100kb)',
        details: {},
        requestId,
      },
    });
  }

  // 2. Custom Application Domain Errors
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
    // Check if it's the doctor slot or patient double booking constraint
    const isPatientOverlap = err.constraint === 'uq_patient_slot_no_overlap';
    const code = isPatientOverlap ? 'PATIENT_DOUBLE_BOOKED' : 'SLOT_TAKEN';
    const message = isPatientOverlap
      ? 'The patient already has an active appointment overlapping this time slot'
      : 'The requested appointment slot is already booked for this doctor';

    return res.status(409).json({
      error: {
        code,
        message,
        details: { constraint: err.constraint },
        requestId,
      },
    });
  }

  // Malformed UUID in a path/query parameter (SQLSTATE 22P02) is a client error, not a server error
  if (err.code === '22P02') {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A path or query parameter has an invalid format (expected a UUID or valid value)',
        details: {},
        requestId,
      },
    });
  }

  // 4. PostgreSQL Unique Constraint Violation (SQLSTATE 23505)
  if (err.code === '23505' && err.constraint === 'uq_invoice_one_per_appointment') {
    return res.status(409).json({
      error: {
        code: 'INVOICE_EXISTS',
        message: 'This appointment already has an active invoice',
        details: {},
        requestId,
      },
    });
  }
  if (err.code === '23505') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with this identifier or unique attribute already exists',
        details: {},
        requestId,
      },
    });
  }

  // 5. PostgreSQL Audit Append-Only Trigger Violation (SQLSTATE 55000)
  if (err.code === '55000') {
    return res.status(403).json({
      error: {
        code: 'AUDIT_IMMUTABLE',
        message: 'Audit log entries cannot be modified or deleted',
        details: {},
        requestId,
      },
    });
  }

  // 6. Generic Internal Server Errors (Do NOT leak stack traces or internal SQL)
  logger.error({ err, requestId }, 'Unhandled Application Error');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal server error occurred',
      details: {},
      requestId,
    },
  });
}

export default errorHandler;
