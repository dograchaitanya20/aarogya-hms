import { describe, it, expect } from 'vitest';
import {
  hospitalLocalToUtc,
  utcToHospitalDateStr,
  utcToHospitalTimeStr,
  getHospitalDayOfWeek,
  HOSPITAL_TZ,
} from '../src/utils/timezone.js';

describe('Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30)', () => {
  it('converts hospital local 09:00 IST to 03:30:00.000Z UTC', () => {
    const utcDate = hospitalLocalToUtc('2026-11-10', '09:00');
    expect(utcDate.toISOString()).toBe('2026-11-10T03:30:00.000Z');
  });

  it('converts hospital local 17:00 IST to 11:30:00.000Z UTC', () => {
    const utcDate = hospitalLocalToUtc('2026-11-10', '17:00');
    expect(utcDate.toISOString()).toBe('2026-11-10T11:30:00.000Z');
  });

  it('correctly maps UTC Date back to hospital local date and time', () => {
    const utcDate = new Date('2026-11-10T03:30:00.000Z');
    expect(utcToHospitalDateStr(utcDate)).toBe('2026-11-10');
    expect(utcToHospitalTimeStr(utcDate)).toBe('09:00:00');
  });

  it('correctly maps hospital local day of week (e.g. 2026-11-10 is Tuesday = 2)', () => {
    const utcDate = new Date('2026-11-10T03:30:00.000Z');
    expect(getHospitalDayOfWeek(utcDate)).toBe(2); // Tuesday
  });

  it('verifies HOSPITAL_TZ is set to Asia/Kolkata', () => {
    expect(HOSPITAL_TZ).toBe('Asia/Kolkata');
  });
});
