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

export class InvalidTransitionError extends ConflictError {
  constructor(message = 'Invalid appointment status transition', details = {}) {
    super(message, 'INVALID_TRANSITION', details);
  }
}
