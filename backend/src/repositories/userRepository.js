import { query } from '../config/db.js';

export async function findByEmail(email) {
  const sql = `
    SELECT u.*, d.id as doctor_id, d.department_id, d.specialization, d.consultation_fee_paise, d.room_number
    FROM users u
    LEFT JOIN doctors d ON d.user_id = u.id
    WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true
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

export default {
  findByEmail,
  findById,
  checkClinicianPatientAccess,
};
