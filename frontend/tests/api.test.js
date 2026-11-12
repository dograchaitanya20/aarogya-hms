import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, explain, fieldErrors, newIdempotencyKey, setUnauthorizedHandler } from '../src/lib/api.js';

const reply = (status, body) => Promise.resolve(new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(() => {});
});

describe('api client', () => {
  it('sends JSON, credentials and the Idempotency-Key header, and skips empty query values', async () => {
    const fetchMock = vi.fn(() => reply(201, { data: { id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/appointments', { method: 'POST', body: { a: 1 }, query: { status: '', page: 2, q: undefined, doctorId: 'x' }, idempotencyKey: 'key-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/appointments?page=2&doctorId=x');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Idempotency-Key']).toBe('key-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('turns the API error envelope into an ApiError with code, status and request id', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(409, { error: { code: 'SLOT_TAKEN', message: 'raw', details: {}, requestId: 'req-9' } })));
    const err = await api('/appointments', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'SLOT_TAKEN', requestId: 'req-9' });
  });

  it('maps a dropped connection to NETWORK_ERROR instead of leaking a TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await api('/patients').catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('survives a non-JSON error body (for example a proxy 502 page)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))));
    const err = await api('/patients').catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('a 401 from any call ends the session, except a failed login (that just means wrong password)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn(() => reply(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })));

    await api('/patients').catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);

    await api('/auth/login', { method: 'POST', body: {} }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('plain-language errors', () => {
  it('replaces technical codes with sentences a front-desk user can act on', () => {
    expect(explain({ code: 'SLOT_TAKEN' })).toMatch(/booked by someone else/i);
    expect(explain({ code: 'PATIENT_DOUBLE_BOOKED' })).toMatch(/already has an appointment/i);
    expect(explain({ code: 'OVERPAYMENT_REJECTED' })).toMatch(/no payment was taken/i);
    expect(explain({ code: 'PAYMENT_DECLINED' })).toMatch(/Nothing was charged/i);
    expect(explain({ code: 'STALE_VERSION' })).toMatch(/Someone else changed/i);
  });

  it('shows the first field message for validation errors, with a readable field name', () => {
    const err = { code: 'VALIDATION_ERROR', details: { 'body.fullName': 'Full name is required' } };
    expect(explain(err)).toBe('Full name: Full name is required');
    expect(fieldErrors(err)).toEqual({ 'body.fullName': 'Full name is required' });
    expect(fieldErrors({ code: 'FORBIDDEN' })).toEqual({});
  });

  it('falls back to the server message, then to a generic sentence', () => {
    expect(explain({ code: 'SOMETHING_NEW', message: 'Server says hello' })).toBe('Server says hello');
    expect(explain({ code: 'SOMETHING_NEW' })).toMatch(/Something went wrong/);
  });
});

describe('idempotency keys', () => {
  it('are unique per call', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});
