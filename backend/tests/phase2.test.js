import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { loginAs } from './helpers.js';
import { hospitalLocalToUtc } from '../src/utils/timezone.js';

describe('Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency', () => {
  let adminAuth;
  let frontDeskAuth;
  let clinician1Auth;
  let clinician2Auth;
  let doctor1;
  let doctor2;
  let patient1;
  let patient2;

  beforeAll(async () => {
    adminAuth = await loginAs('admin@aarogya.local');
    frontDeskAuth = await loginAs('frontdesk1@aarogya.local');
    clinician1Auth = await loginAs('dr.sharma@aarogya.local');
    clinician2Auth = await loginAs('dr.verma@aarogya.local');

    const docRes = await query(
      `SELECT d.id, d.department_id, u.full_name as doctor_name, u.email
       FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE u.email IN ('dr.sharma@aarogya.local', 'dr.verma@aarogya.local');`
    );
    doctor1 = docRes.rows.find((d) => d.email === 'dr.sharma@aarogya.local');
    doctor2 = docRes.rows.find((d) => d.email === 'dr.verma@aarogya.local');

    const patRes = await query('SELECT id, full_name, mrn FROM patients LIMIT 2;');
    patient1 = patRes.rows[0];
    patient2 = patRes.rows[1];
  });

  afterAll(async () => {
    await query("DELETE FROM appointments WHERE reason_for_visit LIKE 'TEST-%'");
  });

  describe('B1: Patient Double-Booking Exclusion Constraint', () => {
    it('blocks the same patient from holding two overlapping appointments across different doctors', async () => {
      const slotStart = hospitalLocalToUtc('2027-02-15', '11:00:00').toISOString(); // Monday
      const slotEnd = hospitalLocalToUtc('2027-02-15', '11:15:00').toISOString();

      // 1. Book patient 1 with doctor 1
      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `test-pat-double-1-${Date.now()}`)
        .send({
          patientId: patient1.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'TEST-First doctor booking',
        });

      expect(res1.status).toBe(201);

      // 2. Attempt to book patient 1 with doctor 2 at the EXACT SAME TIME
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `test-pat-double-2-${Date.now()}`)
        .send({
          patientId: patient1.id,
          doctorId: doctor2.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'TEST-Second doctor overlapping booking',
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('PATIENT_DOUBLE_BOOKED');
      expect(res2.body.error.message).toContain('patient already has an active appointment');
    });
  });

  describe('B2: Slot Computation API', () => {
    it('GET /api/v1/slots computes available slots aligned to schedule in hospital timezone', async () => {
      const res = await request(app)
        .get('/api/v1/slots?doctorId=' + doctor1.id + '&from=2027-02-15&to=2027-02-16')
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const slot = res.body.data[0];
      expect(slot.doctorId).toBe(doctor1.id);
      expect(slot.slotDurationMinutes).toBe(15);
      expect(slot.localStartTime).toBeDefined();
    });

    it('GET /api/v1/slots rejects date ranges exceeding 14 days with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/slots?from=2027-02-01&to=2027-02-25') // 25 days
        .set('Cookie', frontDeskAuth.cookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Date search range cannot exceed 14 days');
    });
  });

  describe('B3: Appointments API Lifecycle & State Machine', () => {
    let createdApt;

    it('books appointment with Idempotency-Key header', async () => {
      const slotStart = hospitalLocalToUtc('2027-02-15', '14:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc('2027-02-15', '14:15:00').toISOString();

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `test-lifecycle-book-${Date.now()}`)
        .send({
          patientId: patient2.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'TEST-Lifecycle verification',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('scheduled');
      expect(res.body.data.version).toBe(1);
      createdApt = res.body.data;

      // Verify audit entry exists
      const auditRes = await query(
        "SELECT * FROM audit_log WHERE action = 'CREATE_APPOINTMENT' AND entity_id = $1;",
        [createdApt.id]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('reschedules appointment and increments version', async () => {
      const newSlotStart = hospitalLocalToUtc('2027-02-15', '14:15:00').toISOString();
      const newSlotEnd = hospitalLocalToUtc('2027-02-15', '14:30:00').toISOString();

      const res = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/reschedule`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({
          startsAt: newSlotStart,
          endsAt: newSlotEnd,
          expectedVersion: createdApt.version,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(createdApt.version + 1);
      createdApt = res.body.data;
    });

    it('rejects reschedule with stale version (409 STALE_VERSION)', async () => {
      const res = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/reschedule`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({
          startsAt: hospitalLocalToUtc('2027-02-15', '14:30:00').toISOString(),
          endsAt: hospitalLocalToUtc('2027-02-15', '14:45:00').toISOString(),
          expectedVersion: 999, // Stale version
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STALE_VERSION');
    });

    it('validates state machine progression (scheduled -> checked_in -> in_consultation -> completed)', async () => {
      // 1. Check in (front desk)
      const res1 = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/status`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ status: 'checked_in' });
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('checked_in');

      // 2. Start consultation (clinician)
      const res2 = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'in_consultation' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('in_consultation');

      // 3. Complete consultation (clinician)
      const res3 = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'completed' });
      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe('completed');
    });

    it('rejects invalid state transition (completed -> scheduled returns 409 INVALID_TRANSITION)', async () => {
      const res = await request(app)
        .patch(`/api/v1/appointments/${createdApt.id}/status`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ status: 'scheduled' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('B5: Idempotency Middleware Semantics', () => {
    it('returns cached response when replaying exact same Idempotency-Key and payload', async () => {
      const key = `idemp-replay-key-${Date.now()}`;
      const payload = {
        patientId: patient1.id,
        doctorId: doctor2.id,
        startsAt: hospitalLocalToUtc('2027-02-15', '16:00:00').toISOString(),
        endsAt: hospitalLocalToUtc('2027-02-15', '16:15:00').toISOString(),
        reasonForVisit: 'TEST-Idempotency replay test',
      };

      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res1.status).toBe(201);
      const originalAptId = res1.body.data.id;

      // Replay exact same request
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.headers['x-cache-lookup']).toBe('HIT-IDEMPOTENT');
      expect(res2.body.data.id).toBe(originalAptId);
    });

    it('returns 422 IDEMPOTENCY_KEY_REUSED when replaying same key with different body payload', async () => {
      const key = `idemp-tamper-key-${Date.now()}`;
      const payload1 = {
        patientId: patient1.id,
        doctorId: doctor2.id,
        startsAt: hospitalLocalToUtc('2027-02-15', '16:15:00').toISOString(),
        endsAt: hospitalLocalToUtc('2027-02-15', '16:30:00').toISOString(),
        reasonForVisit: 'TEST-Original body',
      };

      await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', key)
        .send(payload1);

      // Same key, different body
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', key)
        .send({ ...payload1, reasonForVisit: 'TEST-Tampered different body' });

      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('B6: Directory & Staff Administration', () => {
    it('Admin: creates staff user and deactivates staff', async () => {
      const staffEmail = `newstaff.${Date.now()}@aarogya.local`;
      const res1 = await request(app)
        .post('/api/v1/directory/staff')
        .set('Cookie', adminAuth.cookie)
        .send({
          email: staffEmail,
          password: 'Password123!',
          fullName: 'New Staff Member',
          phone: '+91 9888800000',
          role: 'front_desk',
        });

      expect(res1.status).toBe(201);
      expect(res1.body.data.email).toBe(staffEmail);
      expect(res1.body.data.password_hash).toBeUndefined(); // Never leaked

      const staffId = res1.body.data.id;

      // Deactivate staff
      const res2 = await request(app)
        .patch(`/api/v1/directory/staff/${staffId}/status`)
        .set('Cookie', adminAuth.cookie)
        .send({ isActive: false });

      expect(res2.status).toBe(200);
      expect(res2.body.data.is_active).toBe(false);
    });

    it('Admin: creates schedule rule and rejects overlapping schedule rules', async () => {
      const res1 = await request(app)
        .post('/api/v1/directory/schedules')
        .set('Cookie', adminAuth.cookie)
        .send({
          doctorId: doctor2.id,
          dayOfWeek: 6, // Saturday
          startTime: '09:00:00',
          endTime: '13:00:00',
          slotDurationMinutes: 15,
        });

      expect(res1.status).toBe(201);

      // Attempt overlapping schedule for same doctor on Saturday
      const res2 = await request(app)
        .post('/api/v1/directory/schedules')
        .set('Cookie', adminAuth.cookie)
        .send({
          doctorId: doctor2.id,
          dayOfWeek: 6, // Saturday
          startTime: '11:00:00',
          endTime: '15:00:00',
          slotDurationMinutes: 15,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('CONFLICT');
    });
  });

  describe('Patient Record Updates and Auditing', () => {
    it('Front Desk: updates patient demographics and writes audit log', async () => {
      const updatedPhone = '+91 9999888877';
      const res = await request(app)
        .put(`/api/v1/patients/${patient1.id}`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ phone: updatedPhone });

      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe(updatedPhone);

      // Verify UPDATE_PATIENT audit entry
      const auditRes = await query(
        "SELECT * FROM audit_log WHERE action = 'UPDATE_PATIENT' AND entity_id = $1 ORDER BY ts DESC LIMIT 1;",
        [patient1.id]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].after_state.phone).toBe(updatedPhone);
    });
  });
});
