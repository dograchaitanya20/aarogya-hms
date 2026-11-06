import { query } from '../config/db.js';

export async function getNotesByPatient(patientId) {
  const sql = `
    SELECT cn.*, d.specialization, u.full_name as doctor_name
    FROM clinical_notes cn
    JOIN doctors d ON d.id = cn.doctor_id
    JOIN users u ON u.id = d.user_id
    WHERE cn.patient_id = $1
    ORDER BY cn.created_at DESC;
  `;
  const result = await query(sql, [patientId]);
  return result.rows;
}

export default {
  getNotesByPatient,
};
