// Money is integer paise everywhere. These helpers avoid floating point when parsing input.

const HOSPITAL_TZ = 'Asia/Kolkata'; // India has no daylight saving: a fixed +05:30 offset is safe

// BIGINT columns arrive from the API as strings ("130000"); always go through this
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export function rupees(paise) {
  return inr.format(toNumber(paise) / 100);
}

// "1250.5" -> 125050. Returns null when the text is not a valid amount with at most 2 decimals.
export function rupeesToPaise(text) {
  const clean = String(text ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0') || '0', 10);
}

const dateTime = new Intl.DateTimeFormat('en-IN', { timeZone: HOSPITAL_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const timeOnly = new Intl.DateTimeFormat('en-IN', { timeZone: HOSPITAL_TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const dateOnly = new Intl.DateTimeFormat('en-IN', { timeZone: HOSPITAL_TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: HOSPITAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : '');
export const fmtTime = (iso) => (iso ? timeOnly.format(new Date(iso)) : '');
export const fmtDate = (iso) => (iso ? dateOnly.format(new Date(iso)) : '');

// Today (or any instant) as YYYY-MM-DD in hospital time
export const istDate = (d = new Date()) => ymd.format(d);

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Start and end of a hospital-local day as ISO instants (what the appointments API filters on)
export function istDayRange(dateStr) {
  return {
    from: new Date(`${dateStr}T00:00:00+05:30`).toISOString(),
    to: new Date(`${dateStr}T23:59:59.999+05:30`).toISOString(),
  };
}

export function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export const dobText = (dob) => (dob ? String(dob).slice(0, 10) : '');

export const STATUS_LABEL = {
  scheduled: 'Scheduled',
  checked_in: 'Checked in',
  in_consultation: 'In consultation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  in_progress: 'In progress',
  success: 'Paid',
  declined: 'Declined',
  failed: 'Failed',
};

export const ROLE_LABEL = { admin: 'Administrator', front_desk: 'Front desk', clinician: 'Clinician' };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function hhmm(timeStr) {
  return String(timeStr || '').slice(0, 5);
}
