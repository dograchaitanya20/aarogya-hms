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
  const adminRes = await query("SELECT id, email FROM users WHERE role = 'admin' LIMIT 1;");
  const frontDeskRes = await query("SELECT id, email FROM users WHERE role = 'front_desk' LIMIT 1;");

  return {
    doctors: docRes.rows,
    patients: patientRes.rows,
    admin: adminRes.rows[0],
    frontDesk: frontDeskRes.rows[0],
  };
}
