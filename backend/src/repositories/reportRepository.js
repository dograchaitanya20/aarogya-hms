import { query } from '../config/db.js';

const PAID_RANGE = "status = 'success' AND created_at >= $1 AND created_at < $2";

export async function getSummaryData({ start, end, tz }) {
  const range = [start, end];
  const [appts, revenueByMethod, daily, invoicesByStatus, outstanding, declined, topDoctors] = await Promise.all([
    query(
      `SELECT status, COUNT(*)::int AS count FROM appointments
       WHERE starts_at >= $1 AND starts_at < $2 GROUP BY status`,
      range
    ),
    query(
      `SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(amount_paise), 0) AS total_paise
       FROM payments WHERE ${PAID_RANGE} GROUP BY payment_method`,
      range
    ),
    query(
      `SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, COALESCE(SUM(amount_paise), 0) AS total_paise
       FROM payments WHERE ${PAID_RANGE} GROUP BY 1 ORDER BY 1`,
      [start, end, tz]
    ),
    query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_paise), 0) AS total_paise
       FROM invoices WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
      range
    ),
    query(
      `SELECT COALESCE(SUM(i.total_paise - COALESCE(p.paid, 0)), 0) AS outstanding_paise
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, SUM(amount_paise) AS paid FROM payments WHERE status = 'success' GROUP BY invoice_id
       ) p ON p.invoice_id = i.id
       WHERE i.status <> 'cancelled'`
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM payments
       WHERE status IN ('declined', 'failed') AND created_at >= $1 AND created_at < $2`,
      range
    ),
    query(
      `SELECT d.id AS doctor_id, u.full_name AS doctor_name, COUNT(*)::int AS completed
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users u ON u.id = d.user_id
       WHERE a.status = 'completed' AND a.starts_at >= $1 AND a.starts_at < $2
       GROUP BY d.id, u.full_name
       ORDER BY completed DESC, u.full_name
       LIMIT 5`,
      range
    ),
  ]);

  return {
    appointmentsByStatus: appts.rows,
    revenueByMethod: revenueByMethod.rows,
    dailyRevenue: daily.rows,
    invoicesByStatus: invoicesByStatus.rows,
    outstandingPaise: outstanding.rows[0].outstanding_paise,
    declinedPayments: declined.rows[0].count,
    topDoctors: topDoctors.rows,
  };
}

export default { getSummaryData };
