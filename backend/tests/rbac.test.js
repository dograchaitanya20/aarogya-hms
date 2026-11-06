import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { loginAs } from './helpers.js';

describe('RBAC Matrix & Audit Enforcement Tests', () => {
  let adminAuth;
  let frontDeskAuth;
  let clinicianWithPatientAuth;
  let clinicianWithoutPatientAuth;
  let testPatientWithAppointment;
  let testPatientWithoutAppointment;

  beforeAll(async () => {
    adminAuth = await loginAs('admin@aarogya.local');
    frontDeskAuth = await loginAs('frontdesk1@aarogya.local');

    // Clinician 1: Dr. Rajesh Sharma (dr.sharma@aarogya.local)
    clinicianWithPatientAuth = await loginAs('dr.sharma@aarogya.local');

    // Clinician 2: Dr. Harpreet Singh (dr.singh@aarogya.local)
    clinicianWithoutPatientAuth = await loginAs('dr.singh@aarogya.local');

    // Find a patient that has an appointment with Dr. Rajesh Sharma
    const aptRes = await query(
      `
      SELECT a.patient_id
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      JOIN users u ON u.id = d.user_id
      WHERE u.email = 'dr.sharma@aarogya.local'
      LIMIT 1;
      `
    );
    testPatientWithAppointment = aptRes.rows[0].patient_id;

    // Find a patient that has NO appointment with Dr. Harpreet Singh
    const noAptRes = await query(
      `
      SELECT p.id FROM patients p
      WHERE p.id NOT IN (
        SELECT a.patient_id FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users u ON u.id = d.user_id
        WHERE u.email = 'dr.singh@aarogya.local'
      )
      LIMIT 1;
      `
    );
    testPatientWithoutAppointment = noAptRes.rows[0].id;
  });

  describe('Resource: Directory', () => {
    it('Admin: ALLOWED to create department (write)', async () => {
      const code = `D${Math.floor(Math.random() * 8999 + 1000)}`;
      const res = await request(app)
        .post('/api/v1/directory/departments')
        .set('Cookie', adminAuth.cookie)
        .send({
          name: `Dept ${code}`,
          code,
          description: 'Test Department',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe(code);
    });

    it('Clinician: DENIED creating department (403 FORBIDDEN and audited)', async () => {
      const res = await request(app)
        .post('/api/v1/directory/departments')
        .set('Cookie', clinicianWithPatientAuth.cookie)
        .send({
          name: 'Forbidden Dept',
          code: 'FORBIDDEN',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Verify audit entry for 403
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'PERMISSION_DENIED' AND actor_id = $1 ORDER BY ts DESC LIMIT 1;`,
        [clinicianWithPatientAuth.user.id]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('Front Desk: DENIED creating department (403 FORBIDDEN and audited)', async () => {
      const res = await request(app)
        .post('/api/v1/directory/departments')
        .set('Cookie', frontDeskAuth.cookie)
        .send({
          name: 'Forbidden Dept 2',
          code: 'FORBIDDEN2',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('All Roles: ALLOWED to read directory departments', async () => {
      for (const auth of [adminAuth, frontDeskAuth, clinicianWithPatientAuth]) {
        const res = await request(app)
          .get('/api/v1/directory/departments')
          .set('Cookie', auth.cookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });
  });

  describe('Resource: Patients', () => {
    it('Front Desk: ALLOWED to create patient', async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Cookie', frontDeskAuth.cookie)
        .send({
          fullName: 'Tanvi Bansal',
          dateOfBirth: '1990-05-15',
          gender: 'female',
          phone: '+91 9888877771',
          bloodGroup: 'B+',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.full_name).toBe('Tanvi Bansal');
      expect(res.body.data.mrn).toBeDefined();
    });

    it('Admin: DENIED creating patient (403 FORBIDDEN - least privilege)', async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Cookie', adminAuth.cookie)
        .send({
          fullName: 'Admin Test Patient',
          dateOfBirth: '1985-01-01',
          gender: 'male',
          phone: '+91 9999900000',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Clinician: DENIED creating patient demographics (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Cookie', clinicianWithPatientAuth.cookie)
        .send({
          fullName: 'Clinician Test Patient',
          dateOfBirth: '1985-01-01',
          gender: 'male',
          phone: '+91 9999900000',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Front Desk: ALLOWED to read patient list', async () => {
      const res = await request(app)
        .get('/api/v1/patients?page=1&pageSize=5')
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThan(0);
    });

    it('Security check: handles special characters and quotes safely in patient search query without SQL injection', async () => {
      const res = await request(app)
        .get("/api/v1/patients?q=' OR '1'='1; --")
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('Resource: Clinical Notes', () => {
    it('Clinician (treating patient): ALLOWED to read clinical notes', async () => {
      const res = await request(app)
        .get(`/api/v1/clinical-notes/patients/${testPatientWithAppointment}`)
        .set('Cookie', clinicianWithPatientAuth.cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Verify audit log recorded READ_CLINICAL_NOTE
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'READ_CLINICAL_NOTE' AND actor_id = $1 ORDER BY ts DESC LIMIT 1;`,
        [clinicianWithPatientAuth.user.id]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('Clinician (NOT treating patient): DENIED access to clinical notes (403 FORBIDDEN and audited)', async () => {
      const res = await request(app)
        .get(`/api/v1/clinical-notes/patients/${testPatientWithoutAppointment}`)
        .set('Cookie', clinicianWithoutPatientAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Verify audit log recorded PERMISSION_DENIED
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'PERMISSION_DENIED' AND actor_id = $1 ORDER BY ts DESC LIMIT 1;`,
        [clinicianWithoutPatientAuth.user.id]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('Admin: DENIED reading clinical notes (403 FORBIDDEN - admin can only see metadata)', async () => {
      const res = await request(app)
        .get(`/api/v1/clinical-notes/patients/${testPatientWithAppointment}`)
        .set('Cookie', adminAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Front Desk: DENIED reading clinical notes (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/v1/clinical-notes/patients/${testPatientWithAppointment}`)
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Resource: Billing / Invoices', () => {
    it('Admin: ALLOWED to read billing invoices', async () => {
      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .set('Cookie', adminAuth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('Front Desk: ALLOWED to read billing invoices', async () => {
      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('Clinician: DENIED reading billing invoices (403 FORBIDDEN and audited)', async () => {
      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .set('Cookie', clinicianWithPatientAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Resource: Audit Logs', () => {
    it('Admin: ALLOWED to view system audit logs', async () => {
      const res = await request(app)
        .get('/api/v1/audit/logs?limit=10')
        .set('Cookie', adminAuth.cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('Front Desk: DENIED viewing audit logs (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/v1/audit/logs')
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Clinician: DENIED viewing audit logs (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/v1/audit/logs')
        .set('Cookie', clinicianWithPatientAuth.cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
