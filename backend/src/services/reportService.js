import reportRepository from '../repositories/reportRepository.js';
import { HOSPITAL_TZ, hospitalLocalToUtc, utcToHospitalDateStr } from '../utils/timezone.js';
import { toPaise } from '../utils/money.js';
import { ValidationError } from '../errors/AppError.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// from/to are hospital-local dates (inclusive). Default: the last 30 days up to today.
export async function getSummary({ from, to }) {
  const today = utcToHospitalDateStr(new Date());
  const toDate = to || today;
  const fromDate = from || addDays(toDate, -29);

  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    throw new ValidationError('from and to must be dates in YYYY-MM-DD format.');
  }
  if (fromDate > toDate) {
    throw new ValidationError('from must not be after to.');
  }
  const days = (new Date(toDate) - new Date(fromDate)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ValidationError(`Date range must not exceed ${MAX_RANGE_DAYS} days.`);
  }

  const start = hospitalLocalToUtc(fromDate, '00:00:00').toISOString();
  const end = hospitalLocalToUtc(addDays(toDate, 1), '00:00:00').toISOString();
  const data = await reportRepository.getSummaryData({ start, end, tz: HOSPITAL_TZ });

  const money = (rows) => rows.map((r) => ({ ...r, total_paise: toPaise(r.total_paise) }));
  const revenueByMethod = money(data.revenueByMethod);
  const invoicesByStatus = money(data.invoicesByStatus);

  return {
    range: { from: fromDate, to: toDate, timezone: HOSPITAL_TZ },
    appointmentsByStatus: data.appointmentsByStatus,
    totalAppointments: data.appointmentsByStatus.reduce((s, r) => s + r.count, 0),
    revenuePaise: revenueByMethod.reduce((s, r) => s + r.total_paise, 0),
    revenueByMethod,
    dailyRevenue: money(data.dailyRevenue),
    invoicesByStatus,
    billedPaise: invoicesByStatus.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.total_paise, 0),
    outstandingPaise: toPaise(data.outstandingPaise),
    declinedPayments: data.declinedPayments,
    topDoctors: data.topDoctors,
  };
}

export default { getSummary };
