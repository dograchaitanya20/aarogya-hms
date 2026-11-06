import { query } from '../config/db.js';

export async function getInvoices({ page = 1, pageSize = 20, patientId = null }) {
  const offset = (page - 1) * pageSize;
  let sql = `
    SELECT inv.*, p.full_name as patient_name, p.mrn
    FROM invoices inv
    JOIN patients p ON p.id = inv.patient_id
    WHERE 1=1
  `;
  const values = [];

  if (patientId) {
    values.push(patientId);
    sql += ` AND inv.patient_id = $${values.length}`;
  }

  const countRes = await query(sql.replace('SELECT inv.*, p.full_name as patient_name, p.mrn', 'SELECT COUNT(*) as total'), values);
  const total = parseInt(countRes.rows[0].total, 10);

  values.push(pageSize);
  sql += ` ORDER BY inv.created_at DESC LIMIT $${values.length}`;
  values.push(offset);
  sql += ` OFFSET $${values.length}`;

  const result = await query(sql, values);
  return {
    data: result.rows,
    page,
    pageSize,
    total,
  };
}

export default {
  getInvoices,
};
