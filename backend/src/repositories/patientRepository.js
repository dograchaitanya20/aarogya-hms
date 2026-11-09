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

export async function createPatient(patientData, client = null) {
  const runner = client || { query };
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
  const result = await runner.query(sql, values);
  return result.rows[0];
}

// Whitelist: API field name -> column. Column names never come from user input.
const UPDATABLE_COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  bloodGroup: 'blood_group',
  allergies: 'allergies',
};
const NOT_NULLABLE = new Set(['fullName', 'phone']);

// Row lock so the "before" snapshot in the audit entry is exactly what we overwrite
export async function getPatientForUpdate(id, client) {
  const result = await client.query('SELECT * FROM patients WHERE id = $1 AND is_active = true FOR UPDATE', [id]);
  return result.rows[0] || null;
}

export async function updatePatient(id, changes, client) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (changes[field] === undefined) continue;
    const value = NOT_NULLABLE.has(field) ? changes[field] : changes[field] || null;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(id);
  const result = await client.query(
    `UPDATE patients SET ${sets.join(', ')}, updated_at = clock_timestamp() WHERE id = $${values.length} RETURNING *`,
    values
  );
  return result.rows[0];
}

export function hasUpdatableFields(changes) {
  return Object.keys(UPDATABLE_COLUMNS).some((field) => changes[field] !== undefined);
}

export default {
  getPatients,
  getPatientById,
  createPatient,
  getPatientForUpdate,
  updatePatient,
  hasUpdatableFields,
};
