import { query } from '../config/db.js';

export async function getAllDoctors({ departmentId = null, q = '', isActive = true }) {
  let sql = `
    SELECT d.id, d.user_id, d.department_id, d.specialization, d.consultation_fee_paise,
           d.room_number, d.is_active, d.created_at,
           u.full_name as doctor_name, u.email, u.phone,
           dept.name as department_name, dept.code as department_code
    FROM doctors d
    JOIN users u ON u.id = d.user_id
    JOIN departments dept ON dept.id = d.department_id
    WHERE 1=1
  `;
  const values = [];

  if (isActive !== null) {
    values.push(isActive);
    sql += ` AND d.is_active = $${values.length}`;
  }

  if (departmentId) {
    values.push(departmentId);
    sql += ` AND d.department_id = $${values.length}`;
  }

  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    sql += ` AND (u.full_name ILIKE $${values.length} OR d.specialization ILIKE $${values.length} OR dept.name ILIKE $${values.length})`;
  }

  sql += ` ORDER BY u.full_name ASC;`;

  const result = await query(sql, values);
  return result.rows;
}

export async function getDoctorById(id) {
  const sql = `
    SELECT d.id, d.user_id, d.department_id, d.specialization, d.consultation_fee_paise,
           d.room_number, d.is_active, d.created_at,
           u.full_name as doctor_name, u.email, u.phone,
           dept.name as department_name, dept.code as department_code
    FROM doctors d
    JOIN users u ON u.id = d.user_id
    JOIN departments dept ON dept.id = d.department_id
    WHERE d.id = $1;
  `;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

export async function createDoctor({
  userId,
  departmentId,
  specialization,
  consultationFeePaise,
  roomNumber,
}, client = null) {
  const runner = client || { query };
  const sql = `
    INSERT INTO doctors (user_id, department_id, specialization, consultation_fee_paise, room_number)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const result = await runner.query(sql, [
    userId,
    departmentId,
    specialization,
    consultationFeePaise,
    roomNumber,
  ]);
  return result.rows[0];
}

export async function updateDoctor(id, updates, client = null) {
  const runner = client || { query };
  const fields = [];
  const values = [];

  if (updates.specialization !== undefined) {
    values.push(updates.specialization);
    fields.push(`specialization = $${values.length}`);
  }
  if (updates.consultationFeePaise !== undefined) {
    values.push(updates.consultationFeePaise);
    fields.push(`consultation_fee_paise = $${values.length}`);
  }
  if (updates.roomNumber !== undefined) {
    values.push(updates.roomNumber);
    fields.push(`room_number = $${values.length}`);
  }
  if (updates.isActive !== undefined) {
    values.push(updates.isActive);
    fields.push(`is_active = $${values.length}`);
  }
  if (updates.departmentId !== undefined) {
    values.push(updates.departmentId);
    fields.push(`department_id = $${values.length}`);
  }

  if (fields.length === 0) return getDoctorById(id);

  values.push(id);
  const sql = `
    UPDATE doctors
    SET ${fields.join(', ')}, updated_at = clock_timestamp()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const result = await runner.query(sql, values);
  return result.rows[0];
}

export async function deleteDoctor(id, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    'UPDATE doctors SET is_active = false, updated_at = clock_timestamp() WHERE id = $1 RETURNING *;',
    [id]
  );
  return result.rows[0] || null;
}

export default {
  getAllDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
};
