import { describe, it, expect } from 'vitest';
import { addDays, ageFromDob, fmtTime, istDate, istDayRange, rupees, rupeesToPaise, toNumber } from '../src/lib/format.js';

describe('money helpers (integer paise, never floats)', () => {
  it('parses rupee text to exact paise', () => {
    expect(rupeesToPaise('1250.5')).toBe(125050);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('1,250')).toBe(125000);
    expect(rupeesToPaise('0')).toBe(0);
    expect(rupeesToPaise(' 99.99 ')).toBe(9999);
    // 19.99 is the classic float trap (19.99 * 100 = 1998.9999999999998)
    expect(rupeesToPaise('19.99')).toBe(1999);
  });

  it('rejects anything that is not a plain amount with at most 2 decimals', () => {
    for (const bad of ['', 'abc', '-5', '12.345', '10.', '.5', '1e3', '₹100', '1 000', null, undefined]) {
      expect(rupeesToPaise(bad), `input ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('formats paise as Indian rupees with lakh grouping', () => {
    expect(rupees(125050)).toBe('₹1,250.50');
    expect(rupees(12345600)).toBe('₹1,23,456.00');
    expect(rupees(0)).toBe('₹0.00');
  });

  it('accepts BIGINT strings from the API', () => {
    expect(toNumber('130000')).toBe(130000);
    expect(rupees('130000')).toBe('₹1,300.00');
    expect(toNumber('not a number')).toBe(0);
  });
});

describe('hospital time (Asia/Kolkata, fixed +05:30)', () => {
  it('computes the hospital-local date of an instant', () => {
    expect(istDate(new Date('2026-11-12T20:00:00Z'))).toBe('2026-11-13'); // 01:30 IST next day
    expect(istDate(new Date('2026-11-12T10:00:00Z'))).toBe('2026-11-12');
  });

  it('turns a local day into the exact UTC instants the API filters on', () => {
    expect(istDayRange('2026-11-12')).toEqual({ from: '2026-11-11T18:30:00.000Z', to: '2026-11-12T18:29:59.999Z' });
  });

  it('shows a UTC slot in hospital time', () => {
    expect(fmtTime('2027-01-11T04:30:00.000Z')).toMatch(/^10:00\s?am$/i);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calculates age', () => {
    const today = new Date();
    const dob = `${today.getUTCFullYear() - 30}-01-01`;
    expect(ageFromDob(dob)).toBe(30);
    expect(ageFromDob(null)).toBeNull();
  });
});
