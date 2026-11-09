import { query } from '../config/db.js';

export async function findByEmail(email) {
  const sql = `
    SELECT u.*, d.id as doctor_id, d.department_id, d.specialization, d.consultation_fee_paise, d.room_number
    FROM users u
    LEFT JOIN doctors d ON d.user_id = u.id
    WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true
      AND (d.id IS NULL OR d.is_active = true)
    LIMIT 1;
  `;
  const result = await query(sql, [email.trim()]);
  return result.rows[0] || null;
}

export async function findById(id) {
  const sql = `
    SELECT u.id, u.email, u.role, u.full_name, u.phone, u.is_active, u.created_at,
           d.id as doctor_id, d.department_id, d.specialization, d.consultation_fee_paise, d.room_number,
           dept.name as department_name, dept.code as department_code
    FROM users u
    LEFT JOIN doctors d ON d.user_id = u.id
    LEFT JOIN departments dept ON dept.id = d.department_id
    WHERE u.id = $1 AND u.is_active = true
      AND (d.id IS NULL OR d.is_active = true)
    LIMIT 1;
  `;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

export async function checkClinicianPatientAccess(clinicianUserId, patientId) {
  // Clinician has access to a patient if they have an appointment OR encounter with them
  const sql = `
    SELECT 1 FROM doctors d
    WHERE d.user_id = $1 AND (
      EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = d.id AND a.patient_id = $2)
      OR EXISTS (SELECT 1 FROM encounters e WHERE e.doctor_id = d.id AND e.patient_id = $2)
    )
    LIMIT 1;
  `;
  const result = await query(sql, [clinicianUserId, patientId]);
  return result.rows.length > 0;
}

export async function emailExists(email, client = null) {
  const runner = client || { query };
  const result = await runner.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
  return result.rows.length > 0;
}

export async function createUser({ email, passwordHash, role, fullName, phone }, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `INSERT INTO users (email, password_hash, role, full_name, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, full_name, phone, is_active, created_at`,
    [email.trim(), passwordHash, role, fullName, phone]
  );
  return result.rows[0];
}

// password_hash is never selected here
export async function findStaffForUpdate(id, client) {
  const result = await client.query(
    'SELECT id, email, role, is_active FROM users WHERE id = $1 FOR UPDATE',
    [id]
  );
  return result.rows[0] || null;
}

export async function setActive(id, isActive, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `UPDATE users SET is_active = $2, updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING id, email, role, full_name, phone, is_active, updated_at`,
    [id, Boolean(isActive)]
  );
  return result.rows[0] || null;
}

export async function listStaff({ role = null, page = 1, pageSize = 20, q = '' }) {
  const values = [];
  let where = ' WHERE 1=1';
  if (role) {
    values.push(role);
    where += ` AND role = $${values.length}`;
  }
  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    where += ` AND (full_name ILIKE $${values.length} OR email ILIKE $${values.length})`;
  }
  const countRes = await query(`SELECT COUNT(*) AS total FROM users${where}`, values);
  const total = parseInt(countRes.rows[0].total, 10);
  values.push(pageSize, (page - 1) * pageSize);
  const result = await query(
    `SELECT id, email, role, full_name, phone, is_active, created_at FROM users${where}
     ORDER BY created_at DESC, id LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { data: result.rows, page, pageSize, total };
}

export default {
  findByEmail,
  findById,
  checkClinicianPatientAccess,
  emailExists,
  createUser,
  findStaffForUpdate,
  setActive,
  listStaff,
};
