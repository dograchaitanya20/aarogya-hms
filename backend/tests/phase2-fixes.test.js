import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query, getClient } from '../src/config/db.js';
import { loginAs, getTestDoctorAndPatients } from './helpers.js';
import {
  hospitalLocalToUtc,
  utcToHospitalTimeStr,
  getHospitalDayOfWeek,
} from '../src/utils/timezone.js';
import {
  computeCanonicalHash,
  reapStaleProcessingKeys,
} from '../src/middleware/idempotency.js';
import {
  parseDurationToSeconds,
  validateEnv,
} from '../src/config/env.js';

describe('Phase 2 Round 2 Fixes & Verification Suite', () => {
  let adminAuth;
  let frontDeskAuth;
  let frontDesk2Auth;
  let clinician1Auth;
  let clinician2Auth;
  let doctor1;
  let doctor2;

  // Helper to find next target hospital day of week
  function getNextWeekday(targetDay = 2) {
    const d = new Date();
    const currentDay = d.getDay();
    const diff = (targetDay + 7 - currentDay) % 7 || 7;
    d.setDate(d.getDate() + diff);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function createCleanPatient(name = 'Test Fix Patient') {
    const res = await query(
      `
      INSERT INTO patients (full_name, date_of_birth, gender, phone)
      VALUES ($1, '1992-04-12', 'female', '+91 9876543210')
      RETURNING *;
      `,
      [name]
    );
    return res.rows[0];
  }

  async function get20TestDoctors() {
    const existing = await query(
      `SELECT d.id FROM doctors d
       JOIN doctor_schedules ds ON ds.doctor_id = d.id AND ds.day_of_week = 3
       WHERE d.is_active = true
       GROUP BY d.id
       LIMIT 20;`
    );
    if (existing.rows.length >= 20) {
      return existing.rows;
    }
    const hashRes = await query("SELECT password_hash FROM users WHERE email = 'admin@aarogya.local' LIMIT 1;");
    const validHash = hashRes.rows[0].password_hash;
    const deptRes = await query('SELECT id FROM departments LIMIT 1;');
    const deptId = deptRes.rows[0].id;
    const needed = 20 - existing.rows.length;
    for (let i = 0; i < needed; i++) {
      const uRes = await query(
        `INSERT INTO users (email, password_hash, role, full_name, phone)
         VALUES ($1, $2, 'clinician', $3, '+91 9999999999') RETURNING id;`,
        [`testdoc_extra_${i}_${Date.now()}@aarogya.local`, validHash, `Extra Doctor ${i}`]
      );
      const dRes = await query(
        `INSERT INTO doctors (user_id, department_id, specialization, consultation_fee_paise, room_number)
         VALUES ($1, $2, 'General Medicine', 50000, '999') RETURNING id;`,
        [uRes.rows[0].id, deptId]
      );
      for (let day = 1; day <= 5; day++) {
        await query(
          `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
           VALUES ($1, $2, '09:00:00', '17:00:00', 15);`,
          [dRes.rows[0].id, day]
        );
      }
    }
    const all = await query(
      `SELECT d.id FROM doctors d
       JOIN doctor_schedules ds ON ds.doctor_id = d.id AND ds.day_of_week = 3
       WHERE d.is_active = true
       GROUP BY d.id
       LIMIT 20;`
    );
    return all.rows;
  }

  beforeAll(async () => {
    adminAuth = await loginAs('admin@aarogya.local');
    frontDeskAuth = await loginAs('frontdesk1@aarogya.local');
    frontDesk2Auth = await loginAs('frontdesk2@aarogya.local');

    const testData = await getTestDoctorAndPatients();
    doctor1 = testData.doctors[0];
    doctor2 = testData.doctors[1];

    clinician1Auth = await loginAs(doctor1.email);
    clinician2Auth = await loginAs(doctor2.email);
  });

  // =========================================================================
  // Fix 1: Slot containment with multiple schedule blocks on one weekday
  // =========================================================================
  describe('Fix 1: Slot containment with multiple schedule blocks on one weekday', () => {
    it('selects containing block among multiple blocks and rejects break intervals', async () => {
      const patient = await createCleanPatient('Block Test Patient');

      // Setup: Doctor 2 has two blocks on Sunday (day 0):
      // Block A: 09:00:00 to 12:00:00 (15 min)
      // Block B: 14:00:00 to 17:00:00 (15 min)
      await query('DELETE FROM doctor_schedules WHERE doctor_id = $1 AND day_of_week = 0;', [doctor2.id]);
      await query(
        `
        INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
        VALUES 
          ($1, 0, '09:00:00', '12:00:00', 15),
          ($1, 0, '14:00:00', '17:00:00', 15);
        `,
        [doctor2.id]
      );

      const targetSunday = getNextWeekday(0); // Sunday
      const slotBlockBStart = hospitalLocalToUtc(targetSunday, '14:30:00').toISOString();
      const slotBlockBEnd = hospitalLocalToUtc(targetSunday, '14:45:00').toISOString();

      await query(
        'DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;',
        [doctor2.id, patient.id, slotBlockBStart]
      );

      // Booking in Block B must succeed
      const resSuccess = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `TWO-BLOCKS-OK-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor2.id,
          startsAt: slotBlockBStart,
          endsAt: slotBlockBEnd,
          reasonForVisit: 'Second block Sunday checkup',
        });

      expect(resSuccess.status).toBe(201);
      expect(resSuccess.body.data.id).toBeDefined();

      // Booking during break interval (12:30 to 12:45) must fail with 422
      const slotBreakStart = hospitalLocalToUtc(targetSunday, '12:30:00').toISOString();
      const slotBreakEnd = hospitalLocalToUtc(targetSunday, '12:45:00').toISOString();

      const resBreak = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `TWO-BLOCKS-BREAK-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor2.id,
          startsAt: slotBreakStart,
          endsAt: slotBreakEnd,
          reasonForVisit: 'Break time consultation',
        });

      expect(resBreak.status).toBe(422);
      expect(resBreak.body.error.code).toBe('VALIDATION_ERROR');
      expect(resBreak.body.error.message).toContain("outside doctor's working schedule");
    });
  });

  // =========================================================================
  // Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries
  // =========================================================================
  describe('Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries', () => {
    it('Clinician CANNOT start consultation directly from scheduled (409 INVALID_TRANSITION)', async () => {
      const patient = await createCleanPatient('No Direct Start Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '09:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `NO-DIRECT-START-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Direct start test',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // Clinician attempts directly: scheduled -> in_consultation (NOT ALLOWED per AGENTS.md)
      const directStartRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'in_consultation' });

      expect(directStartRes.status).toBe(409);
      expect(directStartRes.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('Clinician starts consultation from checked_in and completes it', async () => {
      const patient = await createCleanPatient('Proper Flow Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '09:30:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `PROPER-FLOW-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Proper flow test',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // 1. Front Desk checks in patient: scheduled -> checked_in
      const checkInRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ status: 'checked_in' });
      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.data.status).toBe('checked_in');

      // 2. Clinician starts consultation: checked_in -> in_consultation
      const startRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'in_consultation' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.data.status).toBe('in_consultation');

      // 3. Clinician completes consultation: in_consultation -> completed
      const completeRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'completed' });
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.status).toBe('completed');
    });

    it('Clinician CANNOT cancel an appointment (returns 403 FORBIDDEN and logs audit)', async () => {
      const patient = await createCleanPatient('Clinician Cancel Test Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '09:30:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '09:45:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `CLIN-CANCEL-SETUP-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Role test',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // Clinician attempts to cancel their own appointment -> 403 FORBIDDEN
      const cancelRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({
          status: 'cancelled',
          cancellationReason: 'Doctor is busy',
        });

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.error.code).toBe('FORBIDDEN');

      const auditRes = await query(
        `SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'PERMISSION_DENIED';`,
        [`appointment/${aptId}/status`]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });

    it('Front Desk CANNOT start or complete consultation (returns 403 FORBIDDEN)', async () => {
      const patient = await createCleanPatient('FD Consultation Boundary Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '09:45:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '10:00:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `FD-INCONSULT-SETUP-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Consultation boundary test',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // Front desk attempts to start consultation -> 403
      const consultRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ status: 'in_consultation' });

      expect(consultRes.status).toBe(403);
      expect(consultRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // Fix 3: Early Authorization & 403 Audit Logging
  // =========================================================================
  describe('Fix 3: Early Authorization & 403 Audit Logging', () => {
    it('returns 403 (NOT 409) when Clinician 2 attempts invalid transition on Clinician 1 appointment', async () => {
      const patient = await createCleanPatient('Clinician 2 Test Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '10:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '10:15:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `EARLY-AUTH-SETUP-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Doctor 1 appointment',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // Clinician 2 tries to update Clinician 1's appointment with an impossible transition
      const authFirstRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician2Auth.cookie)
        .send({ status: 'completed' });

      expect(authFirstRes.status).toBe(403);
      expect(authFirstRes.body.error.code).toBe('FORBIDDEN');

      const auditLog = await query(
        `SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2;`,
        [`appointment/${aptId}/status`, clinician2Auth.user.id]
      );
      expect(auditLog.rows.length).toBeGreaterThan(0);
    });

    it('Clinician accessing another doctor appointment via GET /appointments/:id returns 403', async () => {
      const patient = await createCleanPatient('Clinician View Test Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '10:15:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '10:30:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `CLIN-GET-SETUP-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Doctor 1 appointment',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      const getRes = await request(app)
        .get(`/api/v1/appointments/${aptId}`)
        .set('Cookie', clinician2Auth.cookie);

      expect(getRes.status).toBe(403);
      expect(getRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // Fix 4: Concurrent Check-In vs Cancel (Optimistic State Locking)
  // =========================================================================
  describe('Fix 4: Concurrent Check-In vs Cancel (Optimistic State Locking)', () => {
    it('exactly one transition succeeds (200) and the other returns 409 INVALID_TRANSITION', async () => {
      const patient = await createCleanPatient('Race Checkin Cancel Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '10:30:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '10:45:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `CHECKIN-VS-CANCEL-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Race check-in vs cancel',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      const [resCheckIn, resCancel] = await Promise.all([
        request(app)
          .patch(`/api/v1/appointments/${aptId}/status`)
          .set('Cookie', frontDeskAuth.cookie)
          .send({ status: 'checked_in', expectedStatus: 'scheduled' }),
        request(app)
          .patch(`/api/v1/appointments/${aptId}/status`)
          .set('Cookie', frontDesk2Auth.cookie)
          .send({ status: 'cancelled', expectedStatus: 'scheduled', cancellationReason: 'Patient called to cancel' }),
      ]);

      const statuses = [resCheckIn.status, resCancel.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      const conflictRes = resCheckIn.status === 409 ? resCheckIn : resCancel;
      expect(conflictRes.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  // =========================================================================
  // Fix 5: Transaction Wrapping (Entity Mutation + Audit Entry in ONE Transaction)
  // =========================================================================
  describe('Fix 5: Transactional Atomicity (Mutation + Audit in One Transaction)', () => {
    it('rolls back appointment creation if audit insertion fails', async () => {
      const patient = await createCleanPatient('Tx Fail Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '10:45:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '11:00:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      const client = await getClient();
      let txErrorOccurred = false;
      const aptNumber = `TEST-TX-FAIL-${Date.now()}`;

      try {
        await client.query('BEGIN');

        // 1. Create appointment in transaction
        await client.query(
          `
          INSERT INTO appointments (
            appointment_number, patient_id, doctor_id, department_id,
            starts_at, ends_at, reason_for_visit, status, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8);
          `,
          [
            aptNumber,
            patient.id,
            doctor1.id,
            doctor1.department_id,
            slotStart,
            slotEnd,
            'Transaction test',
            frontDeskAuth.user.id,
          ]
        );

        // 2. Force an audit failure by inserting an invalid audit record
        await client.query(
          `INSERT INTO audit_log (id, actor_id, actor_role, action, entity_type, entity_id) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'invalid_role', 'TEST', 'test', '123');`
        );

        await client.query('COMMIT');
      } catch (err) {
        txErrorOccurred = true;
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      expect(txErrorOccurred).toBe(true);

      // Verify the appointment was completely rolled back (0 rows)
      const checkApt = await query('SELECT * FROM appointments WHERE appointment_number = $1;', [aptNumber]);
      expect(checkApt.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // Fix 6: Advanced Idempotency Semantics & Scoping
  // =========================================================================
  describe('Fix 6: Advanced Idempotency Semantics & Scoping', () => {
    it('canonicalJsonStringify produces identical hash regardless of key order', () => {
      const obj1 = { z: 1, a: 2, m: { nestedB: true, nestedA: 'test' } };
      const obj2 = { a: 2, m: { nestedA: 'test', nestedB: true }, z: 1 };

      const hash1 = computeCanonicalHash(obj1);
      const hash2 = computeCanonicalHash(obj2);

      expect(hash1).toBe(hash2);
    });

    it('reapStaleProcessingKeys successfully cleans up orphaned processing rows > 60s', async () => {
      const staleKey = `STALE-${Date.now()}`;
      await query(
        `
        INSERT INTO idempotency_keys (
          user_id, idempotency_key, request_path, request_method, request_hash,
          status, response_status, created_at, expires_at
        )
        VALUES ($1, $2, '/test', 'POST', 'dummyhash', 'processing', 0, clock_timestamp() - INTERVAL '120 seconds', clock_timestamp() + INTERVAL '24 hours');
        `,
        [frontDeskAuth.user.id, staleKey]
      );

      const before = await query('SELECT * FROM idempotency_keys WHERE idempotency_key = $1;', [staleKey]);
      expect(before.rows.length).toBe(1);

      await reapStaleProcessingKeys(60);

      const after = await query('SELECT * FROM idempotency_keys WHERE idempotency_key = $1;', [staleKey]);
      expect(after.rows.length).toBe(0);
    });

    it('scopes idempotency keys by user: User 1 and User 2 can reuse the same key independently', async () => {
      const patientA = await createCleanPatient('Idempotency User 1 Patient');
      const patientB = await createCleanPatient('Idempotency User 2 Patient');
      const sharedKey = `SHARED-KEY-${Date.now()}`;
      const targetDate = getNextWeekday(2);

      const slot1Start = hospitalLocalToUtc(targetDate, '11:00:00').toISOString();
      const slot1End = hospitalLocalToUtc(targetDate, '11:15:00').toISOString();
      const slot2Start = hospitalLocalToUtc(targetDate, '11:15:00').toISOString();
      const slot2End = hospitalLocalToUtc(targetDate, '11:30:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at IN ($1, $2);', [
        slot1Start,
        slot2Start,
      ]);

      // User 1 (frontDeskAuth) books with sharedKey
      const resUser1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', sharedKey)
        .send({
          patientId: patientA.id,
          doctorId: doctor1.id,
          startsAt: slot1Start,
          endsAt: slot1End,
          reasonForVisit: 'User 1 booking',
        });
      expect(resUser1.status).toBe(201);

      // User 2 (frontDesk2Auth) books with same sharedKey -> succeeds because key is scoped per user
      const resUser2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDesk2Auth.cookie)
        .set('Idempotency-Key', sharedKey)
        .send({
          patientId: patientB.id,
          doctorId: doctor1.id,
          startsAt: slot2Start,
          endsAt: slot2End,
          reasonForVisit: 'User 2 booking',
        });
      expect(resUser2.status).toBe(201);
    });
  });

  // =========================================================================
  // Fix 7: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions
  // =========================================================================
  describe('Fix 7: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions', () => {
    it(
      'Scenario 1: 20 simultaneous bookings for identical slot -> exactly 1 succeeds (201), 19 get 409 SLOT_TAKEN (fast < 2s)',
      async () => {
        const patient = await createCleanPatient('Scenario 1 Patient');
        const targetDate = getNextWeekday(3); // Wednesday
        const slotStart = hospitalLocalToUtc(targetDate, '09:00:00').toISOString();
        const slotEnd = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1;', [slotStart]);

        const startTime = Date.now();
        const attempts = Array.from({ length: 20 }, (_, idx) => {
          return request(app)
            .post('/api/v1/appointments')
            .set('Cookie', frontDeskAuth.cookie)
            .set('Idempotency-Key', `SC1-RACE-${idx}-${Date.now()}`)
            .send({
              patientId: patient.id,
              doctorId: doctor1.id,
              startsAt: slotStart,
              endsAt: slotEnd,
              reasonForVisit: `Scenario 1 concurrent attempt ${idx}`,
            });
        });

        const responses = await Promise.all(attempts);
        const durationMs = Date.now() - startTime;

        const successes = responses.filter((r) => r.status === 201);
        const slotConflicts = responses.filter(
          (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
        );

        expect(successes.length).toBe(1);
        expect(slotConflicts.length).toBe(19);
        expect(durationMs).toBeLessThan(4000);
      },
      10000
    );

    it(
      'Scenario 2: 20 simultaneous bookings for same patient at same time -> exactly 1 succeeds, 19 get 409 PATIENT_DOUBLE_BOOKED (fast < 2s)',
      async () => {
        const patient = await createCleanPatient('Scenario 2 Patient');
        const targetDate = getNextWeekday(3); // Wednesday
        const slotStart = hospitalLocalToUtc(targetDate, '14:30:00').toISOString();
        const slotEnd = hospitalLocalToUtc(targetDate, '14:45:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1 OR patient_id = $2;', [slotStart, patient.id]);

        const twentyDoctors = await get20TestDoctors();

        const startTime = Date.now();
        const attempts = Array.from({ length: 20 }, (_, idx) => {
          const assignedDoctor = twentyDoctors[idx].id;
          return request(app)
            .post('/api/v1/appointments')
            .set('Cookie', frontDeskAuth.cookie)
            .set('Idempotency-Key', `SC2-PATIENT-${idx}-${Date.now()}`)
            .send({
              patientId: patient.id,
              doctorId: assignedDoctor,
              startsAt: slotStart,
              endsAt: slotEnd,
              reasonForVisit: `Scenario 2 concurrent attempt ${idx}`,
            });
        });

        const responses = await Promise.all(attempts);
        const durationMs = Date.now() - startTime;

        const successes = responses.filter((r) => r.status === 201);
        const patientConflicts = responses.filter(
          (r) => r.status === 409 && r.body.error?.code === 'PATIENT_DOUBLE_BOOKED'
        );

        expect(successes.length).toBe(1);
        expect(patientConflicts.length).toBe(19);
        expect(durationMs).toBeLessThan(4000);
      },
      10000
    );

    it(
      'Scenario 3: 20 simultaneous reschedule requests with expectedVersion: 1 -> exactly 1 succeeds, 19 get 409 STALE_VERSION',
      async () => {
        const patient = await createCleanPatient('Scenario 3 Patient');
        const targetDate = getNextWeekday(3);
        const initialStart = hospitalLocalToUtc(targetDate, '09:30:00').toISOString();
        const initialEnd = hospitalLocalToUtc(targetDate, '09:45:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1;', [initialStart]);

        const bookRes = await request(app)
          .post('/api/v1/appointments')
          .set('Cookie', frontDeskAuth.cookie)
          .set('Idempotency-Key', `SC3-SETUP-${Date.now()}`)
          .send({
            patientId: patient.id,
            doctorId: doctor1.id,
            startsAt: initialStart,
            endsAt: initialEnd,
            reasonForVisit: 'Scenario 3 setup',
          });
        expect(bookRes.status).toBe(201);
        const aptId = bookRes.body.data.id;

        const targetSlots = [
          '10:00:00', '10:15:00', '10:30:00', '10:45:00', '11:00:00',
          '11:15:00', '11:30:00', '11:45:00', '12:00:00', '12:15:00',
          '12:30:00', '12:45:00', '13:00:00', '13:15:00', '13:30:00',
          '13:45:00', '14:00:00', '14:15:00', '15:00:00', '15:15:00',
        ];

        for (const timeStr of targetSlots) {
          const sUtc = hospitalLocalToUtc(targetDate, timeStr).toISOString();
          await query('DELETE FROM appointments WHERE starts_at = $1;', [sUtc]);
        }

        const startTime = Date.now();
        const attempts = targetSlots.map((timeStr) => {
          const sDate = hospitalLocalToUtc(targetDate, timeStr);
          const eDate = new Date(sDate.getTime() + 15 * 60 * 1000);
          return request(app)
            .patch(`/api/v1/appointments/${aptId}/reschedule`)
            .set('Cookie', frontDeskAuth.cookie)
            .send({
              startsAt: sDate.toISOString(),
              endsAt: eDate.toISOString(),
              expectedVersion: 1,
            });
        });

        const responses = await Promise.all(attempts);
        const durationMs = Date.now() - startTime;

        const successes = responses.filter((r) => r.status === 200);
        const staleVersions = responses.filter(
          (r) => r.status === 409 && r.body.error?.code === 'STALE_VERSION'
        );

        expect(successes.length).toBe(1);
        expect(staleVersions.length).toBe(19);
        expect(durationMs).toBeLessThan(4000);
      },
      10000
    );
  });

  // =========================================================================
  // Fix 8: Advanced Vitest Concurrency Test Cases
  // =========================================================================
  describe('Fix 8: Advanced Vitest Concurrency Test Cases', () => {
    it('(a) 10 concurrent POSTs with SAME Idempotency-Key -> exactly 1 row created, responses return same appointment or IDEMPOTENCY_IN_PROGRESS', async () => {
      const patient = await createCleanPatient('Idempotent Race Patient');
      const targetDate = getNextWeekday(4);
      const slotStart = hospitalLocalToUtc(targetDate, '09:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at = $1;', [slotStart]);

      const sharedKey = `CONCURRENT-KEY-${Date.now()}`;
      const attempts = Array.from({ length: 10 }, () => {
        return request(app)
          .post('/api/v1/appointments')
          .set('Cookie', frontDeskAuth.cookie)
          .set('Idempotency-Key', sharedKey)
          .send({
            patientId: patient.id,
            doctorId: doctor1.id,
            startsAt: slotStart,
            endsAt: slotEnd,
            reasonForVisit: 'Concurrent idempotency test',
          });
      });

      const responses = await Promise.all(attempts);

      // Verify DB contains exactly 1 row
      const countRes = await query('SELECT COUNT(*) as count FROM appointments WHERE starts_at = $1;', [slotStart]);
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);

      // All responses should either be 201 (or 200) with the appointment, or 409 IDEMPOTENCY_IN_PROGRESS
      const createdResponses = responses.filter((r) => r.status === 201 || r.status === 200);
      const inProgressResponses = responses.filter(
        (r) => r.status === 409 && r.body.error?.code === 'IDEMPOTENCY_IN_PROGRESS'
      );

      expect(createdResponses.length).toBeGreaterThanOrEqual(1);
      expect(createdResponses.length + inProgressResponses.length).toBe(10);

      const uniqueAptIds = new Set(createdResponses.map((r) => r.body.data?.id));
      expect(uniqueAptIds.size).toBe(1);
    });

    it('(b) 5 concurrent reschedules of different appointments into ONE target slot -> exactly one 200, four SLOT_TAKEN', async () => {
      const targetDate = getNextWeekday(4);
      const targetSlotStart = hospitalLocalToUtc(targetDate, '10:00:00').toISOString();
      const targetSlotEnd = hospitalLocalToUtc(targetDate, '10:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at = $1;', [targetSlotStart]);

      const aptIds = [];
      const initialSlots = [
        ['11:00:00', '11:15:00'],
        ['11:15:00', '11:30:00'],
        ['11:30:00', '11:45:00'],
        ['11:45:00', '12:00:00'],
        ['12:00:00', '12:15:00'],
      ];

      for (let i = 0; i < 5; i++) {
        const p = await createCleanPatient(`Reschedule Clash Patient ${i}`);
        const sUtc = hospitalLocalToUtc(targetDate, initialSlots[i][0]).toISOString();
        const eUtc = hospitalLocalToUtc(targetDate, initialSlots[i][1]).toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1;', [sUtc]);

        const bRes = await request(app)
          .post('/api/v1/appointments')
          .set('Cookie', frontDeskAuth.cookie)
          .set('Idempotency-Key', `CLASH-SETUP-${i}-${Date.now()}`)
          .send({
            patientId: p.id,
            doctorId: doctor1.id,
            startsAt: sUtc,
            endsAt: eUtc,
            reasonForVisit: `Initial appointment ${i}`,
          });
        expect(bRes.status).toBe(201);
        aptIds.push(bRes.body.data.id);
      }

      // Concurrently reschedule all 5 into the exact same target slot
      const attempts = aptIds.map((id) => {
        return request(app)
          .patch(`/api/v1/appointments/${id}/reschedule`)
          .set('Cookie', frontDeskAuth.cookie)
          .send({
            startsAt: targetSlotStart,
            endsAt: targetSlotEnd,
            expectedVersion: 1,
          });
      });

      const responses = await Promise.all(attempts);
      const successes = responses.filter((r) => r.status === 200);
      const slotConflicts = responses.filter(
        (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
      );

      expect(successes.length).toBe(1);
      expect(slotConflicts.length).toBe(4);
    });
  });

  // =========================================================================
  // Fix 9: Reschedule Rollback Proof & Input Validations
  // =========================================================================
  describe('Fix 9: Reschedule Rollback Proof & Input Validations', () => {
    it('Reschedule rollback proof: colliding slot reschedule fails with 409 and keeps appointment unmodified', async () => {
      const patientA = await createCleanPatient('Rollback Patient A');
      const patientB = await createCleanPatient('Rollback Patient B');
      const targetDate = getNextWeekday(4);
      const slotAStart = hospitalLocalToUtc(targetDate, '15:00:00').toISOString();
      const slotAEnd = hospitalLocalToUtc(targetDate, '15:15:00').toISOString();
      const slotBStart = hospitalLocalToUtc(targetDate, '15:15:00').toISOString();
      const slotBEnd = hospitalLocalToUtc(targetDate, '15:30:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at IN ($1, $2);', [
        slotAStart,
        slotBStart,
      ]);

      const resA = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `ROLLBACK-A-${Date.now()}`)
        .send({
          patientId: patientA.id,
          doctorId: doctor1.id,
          startsAt: slotAStart,
          endsAt: slotAEnd,
          reasonForVisit: 'Slot A',
        });
      expect(resA.status).toBe(201);
      const aptAId = resA.body.data.id;

      const resB = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `ROLLBACK-B-${Date.now()}`)
        .send({
          patientId: patientB.id,
          doctorId: doctor1.id,
          startsAt: slotBStart,
          endsAt: slotBEnd,
          reasonForVisit: 'Slot B',
        });
      expect(resB.status).toBe(201);

      // Attempt to reschedule Apt A into occupied Slot B -> 409 SLOT_TAKEN
      const clashRes = await request(app)
        .patch(`/api/v1/appointments/${aptAId}/reschedule`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({
          startsAt: slotBStart,
          endsAt: slotBEnd,
          expectedVersion: 1,
        });

      expect(clashRes.status).toBe(409);
      expect(clashRes.body.error.code).toBe('SLOT_TAKEN');

      // Verify Appointment A remains untouched at Slot A
      const aptACheck = await query('SELECT * FROM appointments WHERE id = $1;', [aptAId]);
      expect(aptACheck.rows[0].starts_at.toISOString()).toBe(slotAStart);
      expect(aptACheck.rows[0].version).toBe(1);
    });

    it('Rejects past, misaligned, and outside-schedule booking attempts with 422 VALIDATION_ERROR', async () => {
      const patient = await createCleanPatient('Validation Patient');
      const targetDate = getNextWeekday(4);

      // Past slot
      const pastRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `PAST-SLOT-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: '2020-01-01T09:00:00.000Z',
          endsAt: '2020-01-01T09:15:00.000Z',
        });
      expect(pastRes.status).toBe(422);

      // Outside schedule hours (23:00)
      const lateStart = hospitalLocalToUtc(targetDate, '23:00:00').toISOString();
      const lateEnd = hospitalLocalToUtc(targetDate, '23:15:00').toISOString();
      const lateRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `LATE-SLOT-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: lateStart,
          endsAt: lateEnd,
        });
      expect(lateRes.status).toBe(422);

      // Misaligned to slot grid (09:07 instead of 09:00 / 09:15)
      const misalignedStart = hospitalLocalToUtc(targetDate, '09:07:00').toISOString();
      const misalignedEnd = hospitalLocalToUtc(targetDate, '09:22:00').toISOString();
      const misalignedRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `MISALIGNED-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: misalignedStart,
          endsAt: misalignedEnd,
        });
      expect(misalignedRes.status).toBe(422);
      expect(misalignedRes.body.error.message).toContain('not aligned');
    });
  });

  // =========================================================================
  // Fix 10: Audit Logging Verification & Pagination/Search
  // =========================================================================
  describe('Fix 10: Audit Logging Verification & Pagination/Search', () => {
    it('Audit logging: records READ_PATIENT_RECORD, UPDATE_PATIENT, and 403 clinician access denial', async () => {
      const patient = await createCleanPatient('Audit Target Patient');

      // 1. Read patient record
      const readRes = await request(app)
        .get(`/api/v1/patients/${patient.id}`)
        .set('Cookie', frontDeskAuth.cookie);
      expect(readRes.status).toBe(200);

      const readAudit = await query(
        `SELECT * FROM audit_log WHERE entity_type = 'patient' AND entity_id = $1 AND action = 'READ_PATIENT_RECORD';`,
        [patient.id]
      );
      expect(readAudit.rows.length).toBeGreaterThan(0);

      // 2. Update patient demographics
      const updateRes = await request(app)
        .put(`/api/v1/patients/${patient.id}`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ phone: '9988776655' });
      expect(updateRes.status).toBe(200);

      const updateAudit = await query(
        `SELECT * FROM audit_log WHERE entity_type = 'patient' AND entity_id = $1 AND action = 'UPDATE_PATIENT' ORDER BY created_at DESC LIMIT 1;`,
        [patient.id]
      );
      expect(updateAudit.rows.length).toBe(1);
      expect(updateAudit.rows[0].after_state.phone).toBe('9988776655');

      // 3. Clinician accessing patient without appointment/encounter gets 403
      const isolatedPatient = await createCleanPatient('Isolated Patient Zero');

      const forbiddenRead = await request(app)
        .get(`/api/v1/patients/${isolatedPatient.id}`)
        .set('Cookie', clinician1Auth.cookie);

      expect(forbiddenRead.status).toBe(403);
      expect(forbiddenRead.body.error.code).toBe('FORBIDDEN');
    });

    it('Pagination and search work correctly on appointments and patients', async () => {
      const aptPageRes = await request(app)
        .get('/api/v1/appointments?page=1&pageSize=5')
        .set('Cookie', frontDeskAuth.cookie);

      expect(aptPageRes.status).toBe(200);
      expect(aptPageRes.body.page).toBe(1);
      expect(aptPageRes.body.pageSize).toBe(5);
      expect(aptPageRes.body.data.length).toBeLessThanOrEqual(5);
      expect(typeof aptPageRes.body.total).toBe('number');

      const patSearchRes = await request(app)
        .get('/api/v1/patients?q=Sharma&pageSize=5')
        .set('Cookie', frontDeskAuth.cookie);

      expect(patSearchRes.status).toBe(200);
      expect(Array.isArray(patSearchRes.body.data)).toBe(true);
    });
  });

  // =========================================================================
  // Fix 11: GET /patients Repo-level Clinician Isolation & Encounter Access
  // =========================================================================
  describe('Fix 11: GET /patients Repo-level Clinician Isolation & Encounter Access', () => {
    it('Clinician sees only patients assigned to them; other patients omitted from list & 403 on getById', async () => {
      const patientDoc1 = await createCleanPatient('Assigned To Doctor 1');
      const patientDoc2 = await createCleanPatient('Assigned To Doctor 2');
      const targetDate = getNextWeekday(2);

      // Book patientDoc1 with doctor1
      const slot1Start = hospitalLocalToUtc(targetDate, '14:00:00').toISOString();
      const slot1End = hospitalLocalToUtc(targetDate, '14:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at IN ($1, $2);', [
        slot1Start,
        hospitalLocalToUtc(targetDate, '14:15:00').toISOString(),
      ]);

      const b1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `BOOK-DOC1-${Date.now()}`)
        .send({
          patientId: patientDoc1.id,
          doctorId: doctor1.id,
          startsAt: slot1Start,
          endsAt: slot1End,
          reasonForVisit: 'Doctor 1 checkup',
        });
      expect(b1.status).toBe(201);

      // Book patientDoc2 with doctor2
      const slot2Start = hospitalLocalToUtc(targetDate, '14:15:00').toISOString();
      const slot2End = hospitalLocalToUtc(targetDate, '14:30:00').toISOString();
      const b2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `BOOK-DOC2-${Date.now()}`)
        .send({
          patientId: patientDoc2.id,
          doctorId: doctor2.id,
          startsAt: slot2Start,
          endsAt: slot2End,
          reasonForVisit: 'Doctor 2 checkup',
        });
      expect(b2.status).toBe(201);

      // Clinician 1 lists patients: patientDoc1 must be present, patientDoc2 must NOT be in the list
      const clin1ListRes = await request(app)
        .get('/api/v1/patients')
        .set('Cookie', clinician1Auth.cookie);

      expect(clin1ListRes.status).toBe(200);
      const patientIdsSeenByDoc1 = clin1ListRes.body.data.map((p) => p.id);
      expect(patientIdsSeenByDoc1).toContain(patientDoc1.id);
      expect(patientIdsSeenByDoc1).not.toContain(patientDoc2.id);

      // Clinician 1 attempts GET /patients/:id on patientDoc2 -> 403 FORBIDDEN + audit
      const forbiddenRes = await request(app)
        .get(`/api/v1/patients/${patientDoc2.id}`)
        .set('Cookie', clinician1Auth.cookie);

      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.body.error.code).toBe('FORBIDDEN');

      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'PERMISSION_DENIED' AND actor_id = $1 AND entity_id = 'patient_record';`,
        [clinician1Auth.user.id]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });

    it('checkClinicianPatientAccess: Clinician can access a patient who has an encounter only (no appointment)', async () => {
      // Patient who was never booked via an appointment with doctor1, but treated in an emergency encounter
      const encounterPatient = await createCleanPatient('Emergency Encounter Patient');

      // Insert encounter directly for doctor1 with appointment_id = NULL
      await query(
        `INSERT INTO encounters (patient_id, doctor_id, appointment_id, status)
         VALUES ($1, $2, NULL, 'in_progress');`,
        [encounterPatient.id, doctor1.id]
      );

      // Verify that this patient has ZERO appointments with doctor1
      const aptCheck = await query(
        'SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2;',
        [encounterPatient.id, doctor1.id]
      );
      expect(aptCheck.rows.length).toBe(0);

      // 1. Clinician 1 listing patients MUST see this patient (matched via encounter)
      const listRes = await request(app)
        .get('/api/v1/patients')
        .set('Cookie', clinician1Auth.cookie);
      expect(listRes.status).toBe(200);
      const ids = listRes.body.data.map((p) => p.id);
      expect(ids).toContain(encounterPatient.id);

      // 2. Clinician 1 accessing patient detail MUST succeed (200 OK)
      const detailRes = await request(app)
        .get(`/api/v1/patients/${encounterPatient.id}`)
        .set('Cookie', clinician1Auth.cookie);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.id).toBe(encounterPatient.id);

      // 3. Clinician 2 (no relationship) accessing patient MUST return 403 FORBIDDEN
      const clin2DetailRes = await request(app)
        .get(`/api/v1/patients/${encounterPatient.id}`)
        .set('Cookie', clinician2Auth.cookie);
      expect(clin2DetailRes.status).toBe(403);
      expect(clin2DetailRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // Fix 12: Directory Admin Administration & RBAC Enforcement
  // =========================================================================
  describe('Fix 12: Directory Admin Administration & RBAC Enforcement', () => {
    it('GET /doctors/:id returns doctor details for admin, clinician and front_desk', async () => {
      for (const auth of [adminAuth, frontDeskAuth, clinician1Auth]) {
        const res = await request(app)
          .get(`/api/v1/directory/doctors/${doctor1.id}`)
          .set('Cookie', auth.cookie);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(doctor1.id);
        expect(res.body.data.doctor_name).toBeDefined();
      }
    });

    it('Admin can PATCH and DELETE department, clinician/front_desk get 403', async () => {
      // 1. Create temporary department with unique name & code
      const ts = Date.now().toString().slice(-6);
      const deptCode = `T${ts}`;
      const deptName = `Test Dept ${ts}`;
      const renamedName = `Renamed Dept ${ts}`;

      const deptRes = await query(
        `INSERT INTO departments (code, name, description) VALUES ($1, $2, 'Dept description') RETURNING id;`,
        [deptCode, deptName]
      );
      const deptId = deptRes.rows[0].id;

      // 2. Clinician attempts PATCH -> 403
      const clinPatch = await request(app)
        .patch(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ name: 'Hacked Dept' });
      expect(clinPatch.status).toBe(403);

      // 3. Admin PATCH -> 200
      const adminPatch = await request(app)
        .patch(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', adminAuth.cookie)
        .send({ name: renamedName });
      expect(adminPatch.status).toBe(200);
      expect(adminPatch.body.data.name).toBe(renamedName);

      // 4. Front Desk attempts DELETE -> 403
      const fdDelete = await request(app)
        .delete(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', frontDeskAuth.cookie);
      expect(fdDelete.status).toBe(403);

      // 5. Admin DELETE -> 200
      const adminDelete = await request(app)
        .delete(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', adminAuth.cookie);
      expect(adminDelete.status).toBe(200);

      // 6. Verify audit entry was logged
      const auditLog = await query(
        `SELECT * FROM audit_log WHERE entity_type = 'department' AND entity_id = $1 AND action = 'DELETE_DEPARTMENT';`,
        [deptId]
      );
      expect(auditLog.rows.length).toBe(1);
    });

    it('Admin can PATCH and DELETE doctor & schedule rules with auditing', async () => {
      // 1. Create a dummy doctor to update and delete
      const hashRes = await query("SELECT password_hash FROM users WHERE email = 'admin@aarogya.local' LIMIT 1;");
      const validHash = hashRes.rows[0].password_hash;
      const deptRes = await query('SELECT id FROM departments LIMIT 1;');
      const deptId = deptRes.rows[0].id;

      const uRes = await query(
        `INSERT INTO users (email, password_hash, role, full_name, phone)
         VALUES ($1, $2, 'clinician', 'Modifiable Doctor', '+91 9999900000') RETURNING id;`,
        [`mod_doc_${Date.now()}@aarogya.local`, validHash]
      );
      const docRes = await query(
        `INSERT INTO doctors (user_id, department_id, specialization, consultation_fee_paise, room_number)
         VALUES ($1, $2, 'Neurology', 70000, '505') RETURNING id;`,
        [uRes.rows[0].id, deptId]
      );
      const modDocId = docRes.rows[0].id;

      // 2. Admin patches doctor
      const patchDocRes = await request(app)
        .patch(`/api/v1/directory/doctors/${modDocId}`)
        .set('Cookie', adminAuth.cookie)
        .send({ roomNumber: 'Room 999', consultationFeePaise: 85000 });
      expect(patchDocRes.status).toBe(200);
      expect(patchDocRes.body.data.room_number).toBe('Room 999');
      expect(patchDocRes.body.data.consultation_fee_paise).toBe('85000');

      // 3. Create schedule rule and patch it
      const schedRes = await query(
        `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, 6, '10:00:00', '14:00:00', 15) RETURNING id;`,
        [modDocId]
      );
      const schedId = schedRes.rows[0].id;

      const patchSchedRes = await request(app)
        .patch(`/api/v1/directory/schedules/${schedId}`)
        .set('Cookie', adminAuth.cookie)
        .send({ endTime: '15:00:00' });
      expect(patchSchedRes.status).toBe(200);
      expect(patchSchedRes.body.data.end_time).toBe('15:00:00');

      // 4. Admin deletes schedule rule
      const delSchedRes = await request(app)
        .delete(`/api/v1/directory/schedules/${schedId}`)
        .set('Cookie', adminAuth.cookie);
      expect(delSchedRes.status).toBe(200);

      // 5. Admin deactivates/deletes doctor
      const delDocRes = await request(app)
        .delete(`/api/v1/directory/doctors/${modDocId}`)
        .set('Cookie', adminAuth.cookie);
      expect(delDocRes.status).toBe(200);

      // 6. Verify audit logs
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE entity_id = $1 AND action IN ('UPDATE_DOCTOR', 'DELETE_DOCTOR');`,
        [modDocId]
      );
      expect(auditRes.rows.length).toBe(2);
    });
  });

  // =========================================================================
  // Fix 13: env.js Security Validations
  // =========================================================================
  describe('Fix 13: env.js Security Validations', () => {
    it('parseDurationToSeconds accurately parses duration strings', () => {
      expect(parseDurationToSeconds('15m')).toBe(15 * 60);
      expect(parseDurationToSeconds('1h')).toBe(3600);
      expect(parseDurationToSeconds('8h')).toBe(8 * 3600);
      expect(parseDurationToSeconds('2d')).toBe(2 * 86400);
      expect(parseDurationToSeconds('3600')).toBe(3600);
      expect(parseDurationToSeconds(null)).toBe(0);
    });

    it('validateEnv rejects missing/short JWT_SECRET in development/production', () => {
      expect(() => {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: '',
          JWT_EXPIRES_IN: '8h',
        });
      }).toThrow(/JWT_SECRET must be set/);

      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'short-secret-less-than-32-chars',
          JWT_EXPIRES_IN: '8h',
        });
      }).toThrow(/at least 32 characters/);
    });

    it('validateEnv rejects JWT_EXPIRES_IN greater than 8 hours', () => {
      expect(() => {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: 'this-is-a-valid-secure-jwt-secret-string-32-chars',
          JWT_EXPIRES_IN: '9h',
        });
      }).toThrow(/must not exceed 8 hours/);

      expect(() => {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: 'this-is-a-valid-secure-jwt-secret-string-32-chars',
          JWT_EXPIRES_IN: '1d',
        });
      }).toThrow(/must not exceed 8 hours/);
    });

    it('validateEnv accepts valid 8h expiry and 32+ character secrets', () => {
      expect(() => {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: 'this-is-a-valid-secure-jwt-secret-string-32-chars',
          JWT_EXPIRES_IN: '8h',
        });
      }).not.toThrow();

      expect(() => {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: 'this-is-a-valid-secure-jwt-secret-string-32-chars',
          JWT_EXPIRES_IN: '4h',
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Fix 14: PostgreSQL Sequences & Input Validation
  // =========================================================================
  describe('Fix 14: PostgreSQL Sequences & Input Validation', () => {
    it('generates sequential appointment numbers and MRNs via PostgreSQL sequences', async () => {
      const p1 = await createCleanPatient('Sequence Patient 1');
      const p2 = await createCleanPatient('Sequence Patient 2');

      expect(p1.mrn).toMatch(/^MRN-\d{4}-\d{6}$/);
      expect(p2.mrn).toMatch(/^MRN-\d{4}-\d{6}$/);

      const targetDate = getNextWeekday(2);
      const slot1Start = hospitalLocalToUtc(targetDate, '16:00:00').toISOString();
      const slot1End = hospitalLocalToUtc(targetDate, '16:15:00').toISOString();
      const slot2Start = hospitalLocalToUtc(targetDate, '16:15:00').toISOString();
      const slot2End = hospitalLocalToUtc(targetDate, '16:30:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at IN ($1, $2);', [slot1Start, slot2Start]);

      const resApt1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `SEQ-APT-1-${Date.now()}`)
        .send({
          patientId: p1.id,
          doctorId: doctor1.id,
          startsAt: slot1Start,
          endsAt: slot1End,
          reasonForVisit: 'Seq check 1',
        });
      expect(resApt1.status).toBe(201);
      expect(resApt1.body.data.appointment_number).toMatch(/^APT-\d{4}-\d{6}$/);

      const resApt2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `SEQ-APT-2-${Date.now()}`)
        .send({
          patientId: p2.id,
          doctorId: doctor1.id,
          startsAt: slot2Start,
          endsAt: slot2End,
          reasonForVisit: 'Seq check 2',
        });
      expect(resApt2.status).toBe(201);
      expect(resApt2.body.data.appointment_number).toMatch(/^APT-\d{4}-\d{6}$/);

      // Verify numbers are monotonically increasing
      const num1 = parseInt(resApt1.body.data.appointment_number.split('-')[2], 10);
      const num2 = parseInt(resApt2.body.data.appointment_number.split('-')[2], 10);
      expect(num2).toBeGreaterThan(num1);
    });

    it('PUT /patients/:id returns 422 VALIDATION_ERROR when no update fields are given', async () => {
      const patient = await createCleanPatient('No Update Patient');

      const res = await request(app)
        .put(`/api/v1/patients/${patient.id}`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('At least one field must be provided');
    });
  });
});
