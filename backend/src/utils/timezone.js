import { HOSPITAL_TZ } from '../config/env.js';

export { HOSPITAL_TZ };

/**
 * Utility functions for Hospital Timezone conversions (Asia/Kolkata = UTC+05:30)
 */

/**
 * Converts a hospital-local date (YYYY-MM-DD) and time (HH:mm or HH:mm:ss) to a UTC Date object.
 * Example: '2026-11-10' and '09:00' in Asia/Kolkata -> 2026-11-10T03:30:00.000Z
 */
export function hospitalLocalToUtc(dateStr, timeStr) {
  // Normalize timeStr to HH:mm:ss
  const parts = timeStr.split(':');
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].padStart(2, '0');
  const seconds = (parts[2] || '00').padStart(2, '0');

  // Asia/Kolkata has a constant offset of +05:30 (no Daylight Saving Time)
  const isoLocalString = `${dateStr}T${hours}:${minutes}:${seconds}+05:30`;
  const date = new Date(isoLocalString);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date/time provided: date='${dateStr}', time='${timeStr}'`);
  }

  return date;
}

/**
 * Formats a UTC Date into hospital-local date string 'YYYY-MM-DD'
 */
export function utcToHospitalDateStr(utcDate) {
  const d = new Date(utcDate);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOSPITAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d); // Returns 'YYYY-MM-DD'
}

/**
 * Formats a UTC Date into hospital-local time string 'HH:mm:ss'
 */
export function utcToHospitalTimeStr(utcDate) {
  const d = new Date(utcDate);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOSPITAL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(d); // Returns 'HH:mm:ss'
}

/**
 * Returns the day of week (0=Sunday, 1=Monday, ..., 6=Saturday) in hospital local timezone
 */
export function getHospitalDayOfWeek(utcDate) {
  const d = new Date(utcDate);
  const localDateStr = utcToHospitalDateStr(d);
  const [year, month, day] = localDateStr.split('-').map(Number);
  // Construct date in local terms to get day of week
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export default {
  HOSPITAL_TZ,
  hospitalLocalToUtc,
  utcToHospitalDateStr,
  utcToHospitalTimeStr,
  getHospitalDayOfWeek,
};
