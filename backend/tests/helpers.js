import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/config/db.js';

export async function loginAs(email, password = 'Password123!') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  const cookie = res.headers['set-cookie'];
  const token = res.body.token;

  return {
    response: res,
    cookie,
    token,
    user: res.body.user,
  };
}

export async function getTestDoctorAndPatients() {
  const docRes = await query(
    `SELECT d.id, d.department_id, d.user_id, u.email
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE u.email LIKE 'dr.%@aarogya.local'
     ORDER BY u.email ASC
     LIMIT 2;`
  );
  const patientRes = await query('SELECT id, full_name, mrn FROM patients ORDER BY created_at ASC LIMIT 3;');
  const adminRes = await query("SELECT id, email FROM users WHERE email = 'admin@aarogya.local';");
  // Deterministic: tests create throwaway staff accounts, so never pick "any" front_desk user
  const frontDeskRes = await query(
    "SELECT id, email FROM users WHERE role = 'front_desk' AND email LIKE 'frontdesk%@aarogya.local' ORDER BY email LIMIT 1;"
  );

  return {
    doctors: docRes.rows,
    patients: patientRes.rows,
    admin: adminRes.rows[0],
    frontDesk: frontDeskRes.rows[0],
  };
}

// Test cleanup: appointments that reached in_consultation own an encounter (FK is RESTRICT on purpose:
// clinical data must never cascade-delete in production). Tests remove the dependents explicitly first.
export async function deleteAppointmentsWhere(whereSql, params = []) {
  const found = await query(`SELECT id FROM appointments WHERE ${whereSql}`, params);
  const ids = found.rows.map((r) => r.id);
  if (ids.length === 0) return;
  const encounterIds = `SELECT id FROM encounters WHERE appointment_id = ANY($1)`;
  await query(`DELETE FROM clinical_notes WHERE encounter_id IN (${encounterIds})`, [ids]);
  await query(`DELETE FROM prescriptions WHERE encounter_id IN (${encounterIds})`, [ids]);
  await query('DELETE FROM encounters WHERE appointment_id = ANY($1)', [ids]);
  await query('DELETE FROM appointments WHERE id = ANY($1)', [ids]);
}
