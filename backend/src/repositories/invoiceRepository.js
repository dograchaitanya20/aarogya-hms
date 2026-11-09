import { query } from '../config/db.js';

const SORTABLE = {
  created_at: 'inv.created_at',
  total_paise: 'inv.total_paise',
  invoice_number: 'inv.invoice_number',
};

export async function getInvoices({
  page = 1,
  pageSize = 20,
  patientId = null,
  status = null,
  q = '',
  from = null,
  to = null,
  sort = 'created_at',
  dir = 'desc',
}) {
  const offset = (page - 1) * pageSize;
  const values = [];
  let where = ' WHERE 1=1';

  if (patientId) {
    values.push(patientId);
    where += ` AND inv.patient_id = $${values.length}`;
  }
  if (status) {
    values.push(status);
    where += ` AND inv.status = $${values.length}`;
  }
  if (q) {
    values.push(`%${q}%`);
    where += ` AND (inv.invoice_number ILIKE $${values.length} OR p.full_name ILIKE $${values.length} OR p.mrn ILIKE $${values.length})`;
  }
  if (from) {
    values.push(from);
    where += ` AND inv.created_at >= $${values.length}`;
  }
  if (to) {
    values.push(to);
    where += ` AND inv.created_at < $${values.length}`;
  }

  const base = ` FROM invoices inv JOIN patients p ON p.id = inv.patient_id${where}`;
  const countRes = await query(`SELECT COUNT(*) AS total${base}`, values);
  const total = parseInt(countRes.rows[0].total, 10);

  const sortColumn = SORTABLE[sort] || SORTABLE.created_at;
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  values.push(pageSize, offset);
  const result = await query(
    `SELECT inv.*, p.full_name AS patient_name, p.mrn${base}
     ORDER BY ${sortColumn} ${sortDir}, inv.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { data: result.rows, page, pageSize, total };
}

export async function findInvoiceById(id, client = null) {
  const runner = client || { query };
  const res = await runner.query(
    `SELECT inv.*, p.full_name AS patient_name, p.mrn
     FROM invoices inv JOIN patients p ON p.id = inv.patient_id
     WHERE inv.id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

// Row lock: serialises concurrent payments / cancellation on the same invoice
export async function findInvoiceForUpdate(id, client) {
  const res = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
  return res.rows[0] || null;
}

export async function getInvoiceItems(invoiceId, client = null) {
  const runner = client || { query };
  const res = await runner.query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at, id',
    [invoiceId]
  );
  return res.rows;
}

export async function getPayments(invoiceId, client = null) {
  const runner = client || { query };
  const res = await runner.query(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at, id',
    [invoiceId]
  );
  return res.rows;
}

export async function sumSuccessfulPayments(invoiceId, client = null) {
  const runner = client || { query };
  const res = await runner.query(
    "SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM payments WHERE invoice_id = $1 AND status = 'success'",
    [invoiceId]
  );
  return res.rows[0].paid;
}

export async function insertInvoice(
  { patientId, appointmentId, subtotalPaise, taxPaise, discountPaise, totalPaise, status, createdBy },
  client
) {
  const res = await client.query(
    `INSERT INTO invoices (patient_id, appointment_id, subtotal_paise, tax_paise, discount_paise, total_paise, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [patientId, appointmentId, subtotalPaise, taxPaise, discountPaise, totalPaise, status, createdBy]
  );
  return res.rows[0];
}

export async function insertInvoiceItem({ invoiceId, description, quantity, unitPricePaise }, client) {
  const res = await client.query(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_paise, total_paise)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [invoiceId, description, quantity, unitPricePaise, quantity * unitPricePaise]
  );
  return res.rows[0];
}

export async function insertPayment(
  { invoiceId, amountPaise, method, status, cardLastFour, failureReason, createdBy },
  client
) {
  // Generate the payment number first so the simulated gateway id can reference it deterministically
  const res = await client.query(
    `WITH n AS (
       SELECT 'PAY-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_payment_number')::TEXT, 6, '0') AS num
     )
     INSERT INTO payments (payment_number, invoice_id, amount_paise, payment_method, status, card_last_four, failure_reason, created_by, gateway_transaction_id)
     SELECT n.num, $1, $2, $3, $4, $5, $6, $7, 'sim_txn_' || n.num FROM n
     RETURNING *`,
    [invoiceId, amountPaise, method, status, cardLastFour, failureReason, createdBy]
  );
  return res.rows[0];
}

export async function updateInvoiceStatus(id, status, client) {
  const res = await client.query(
    'UPDATE invoices SET status = $2, updated_at = clock_timestamp() WHERE id = $1 RETURNING *',
    [id, status]
  );
  return res.rows[0];
}

export async function cancelInvoice(id, reason, client) {
  const res = await client.query(
    `UPDATE invoices SET status = 'cancelled', cancellation_reason = $2, updated_at = clock_timestamp()
     WHERE id = $1 RETURNING *`,
    [id, reason]
  );
  return res.rows[0];
}

export default {
  getInvoices,
  findInvoiceById,
  findInvoiceForUpdate,
  getInvoiceItems,
  getPayments,
  sumSuccessfulPayments,
  insertInvoice,
  insertInvoiceItem,
  insertPayment,
  updateInvoiceStatus,
  cancelInvoice,
};
