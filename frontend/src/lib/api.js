// One fetch wrapper for the whole app. Every API error has the same shape:
// { error: { code, message, details, requestId } } and becomes an ApiError here.

export class ApiError extends Error {
  constructor({ status, code, message, details = {}, requestId = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toQueryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, query, idempotencyKey, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(`/api/v1${path}${toQueryString(query)}`, {
      method,
      headers,
      credentials: 'include', // the session is an httpOnly cookie; JavaScript never sees the token
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check that the API is running and try again.',
    });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const e = data?.error || {};
    const error = new ApiError({
      status: res.status,
      code: e.code || `HTTP_${res.status}`,
      message: e.message || `The request failed (${res.status}).`,
      details: e.details || {},
      requestId: e.requestId || null,
    });
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw error;
  }
  return data;
}

// Plain-language messages for the codes the API can return. The UI shows these, never raw codes.
const MESSAGES = {
  SLOT_TAKEN: 'That time was just booked by someone else. Pick another slot.',
  PATIENT_DOUBLE_BOOKED: 'This patient already has an appointment at that time.',
  STALE_VERSION: 'Someone else changed this appointment. It has been reloaded. Review it and try again.',
  INVALID_TRANSITION: 'That status change is not allowed from the appointment’s current status.',
  IDEMPOTENCY_IN_PROGRESS: 'This request is already being processed. Wait a moment before retrying.',
  IDEMPOTENCY_KEY_REUSED: 'This request key was already used with different details. Start the action again.',
  OVERPAYMENT_REJECTED: 'That amount is more than the outstanding balance, so no payment was taken.',
  PAYMENT_DECLINED: 'The card was declined. Nothing was charged.',
  INVOICE_EXISTS: 'This appointment already has an active invoice.',
  INVOICE_ALREADY_PAID: 'This invoice is already fully paid.',
  INVOICE_CANCELLED: 'This invoice was cancelled.',
  INVOICE_HAS_PAYMENTS: 'An invoice with payments cannot be cancelled.',
  ENCOUNTER_CLOSED: 'This consultation is closed, so notes and prescriptions can no longer be added.',
  CANNOT_DEACTIVATE_SELF: 'You cannot deactivate your own account.',
  FORBIDDEN: 'Your role does not allow this action.',
  RATE_LIMIT_EXCEEDED: 'Too many attempts. Wait a few minutes and try again.',
  UNAUTHORIZED: 'Your session has ended. Sign in again.',
  NETWORK_ERROR: 'Cannot reach the server. Check that the API is running and try again.',
};

export function prettyField(path) {
  const last = String(path).split('.').pop().replace(/([A-Z])/g, ' $1').toLowerCase();
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function explain(err) {
  if (!err) return '';
  if (err.code === 'VALIDATION_ERROR') {
    const first = Object.entries(err.details || {})[0];
    return first ? `${prettyField(first[0])}: ${first[1]}` : 'Some details are missing or invalid.';
  }
  return MESSAGES[err.code] || err.message || 'Something went wrong. Try again.';
}

// Field-level messages for forms: { fullName: 'Too short' }
export function fieldErrors(err) {
  return err?.code === 'VALIDATION_ERROR' ? err.details || {} : {};
}
