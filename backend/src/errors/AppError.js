export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = {}) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details = {}) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details = {}) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource not found', details = {}) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict with current state', code = 'CONFLICT', details = {}) {
    super(message, 409, code, details);
  }
}

export class SlotTakenError extends ConflictError {
  constructor(message = 'The requested appointment slot is already booked for this doctor', details = {}) {
    super(message, 'SLOT_TAKEN', details);
  }
}

export class PatientDoubleBookedError extends ConflictError {
  constructor(message = 'The patient already has an active appointment overlapping this time slot', details = {}) {
    super(message, 'PATIENT_DOUBLE_BOOKED', details);
  }
}

export class InvalidTransitionError extends ConflictError {
  constructor(message = 'Invalid appointment status transition', details = {}) {
    super(message, 'INVALID_TRANSITION', details);
  }
}

export class StaleVersionError extends ConflictError {
  constructor(message = 'The appointment was modified by another request. Please reload and try again.', details = {}) {
    super(message, 'STALE_VERSION', details);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(message = 'Idempotency key was previously used with a different request payload', details = {}) {
    super(message, 422, 'IDEMPOTENCY_KEY_REUSED', details);
  }
}

export class IdempotencyInProgressError extends ConflictError {
  constructor(message = 'A request with this idempotency key is currently being processed. Please retry shortly.', details = {}) {
    super(message, 'IDEMPOTENCY_IN_PROGRESS', details);
  }
}

export class OverpaymentRejectedError extends AppError {
  constructor(message = 'Payment exceeds the outstanding invoice balance and was rejected', details = {}) {
    super(message, 422, 'OVERPAYMENT_REJECTED', details);
  }
}
