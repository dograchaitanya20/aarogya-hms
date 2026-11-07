import { query } from '../config/db.js';

export async function getPatients({ page = 1, pageSize = 20, q = '', clinicianDoctorId = null }) {
  const offset = (page - 1) * pageSize;
  let sql = 'SELECT * FROM patients WHERE is_active = true';
  const values = [];

  if (clinicianDoctorId) {
    values.push(clinicianDoctorId);
    sql += ` AND (
      id IN (SELECT patient_id FROM appointments WHERE doctor_id = $${values.length})
      OR id IN (SELECT patient_id FROM encounters WHERE doctor_id = $${values.length})
    )`;
  }

  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    sql += ` AND (full_name ILIKE $${values.length} OR mrn ILIKE $${values.length} OR phone ILIKE $${values.length})`;
  }

  // Count total
  const countRes = await query(
    sql.replace('SELECT *', 'SELECT COUNT(*) as total'),
    values
  );
  const total = parseInt(countRes.rows[0].total, 10);

  // Pagination
  values.push(pageSize);
  sql += ` ORDER BY created_at DESC LIMIT $${values.length}`;
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

export async function getPatientById(id) {
  const result = await query('SELECT * FROM patients WHERE id = $1 AND is_active = true', [id]);
  return result.rows[0] || null;
}

export async function createPatient(patientData) {
  const sql = `
    INSERT INTO patients (
      mrn, full_name, date_of_birth, gender, phone, email,
      address, emergency_contact_name, emergency_contact_phone, blood_group, allergies
    )
    VALUES (
      COALESCE($1, 'MRN-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_patient_mrn')::TEXT, 6, '0')),
      $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    )
    RETURNING *;
  `;
  const values = [
    patientData.mrn || null,
    patientData.fullName,
    patientData.dateOfBirth,
    patientData.gender,
    patientData.phone,
    patientData.email || null,
    patientData.address || null,
    patientData.emergencyContactName || null,
    patientData.emergencyContactPhone || null,
    patientData.bloodGroup || null,
    patientData.allergies || null,
  ];
  const result = await query(sql, values);
  return result.rows[0];
}

export default {
  getPatients,
  getPatientById,
  createPatient,
};
