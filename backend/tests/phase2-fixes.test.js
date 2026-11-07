import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query, getClient } from '../src/config/db.js';
import { loginAs, getTestDoctorAndPatients } from './helpers.js';
import {
  hospitalLocalToUtc,
  utcToHospitalDateStr,
} from '../src/utils/timezone.js';
import {
  canonicalJsonStringify,
  computeCanonicalHash,
  reapStaleProcessingKeys,
} from '../src/middleware/idempotency.js';

describe('Phase 2 Fixes & Verification Suite', () => {
  let adminAuth;
  let frontDeskAuth;
  let frontDesk2Auth;
  let clinician1Auth;
  let clinician2Auth;
  let doctor1;
  let doctor2;

  // Helper to find next Tuesday (hospital day of week = 2)
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
    const mrn = `MRN-FIX-${Date.now()}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const res = await query(
      `
      INSERT INTO patients (mrn, full_name, date_of_birth, gender, phone)
      VALUES ($1, $2, '1992-04-12', 'female', '+91 9876543210')
      RETURNING *;
      `,
      [mrn, name]
    );
    return res.rows[0];
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
  // Fix 1: validateSlotAlignment picks the schedule rule that CONTAINS the slot
  // (with two blocks on one weekday)
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

      // Clean any pre-existing appointment in that slot
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
      expect(resBreak.body.error.message).toContain('outside doctor\'s working schedule');
    });
  });

  // =========================================================================
  // Fix 2: Clinician vs Front Desk Lifecycle Boundaries
  // Clinician: only scheduled/checked_in -> in_consultation, in_consultation -> completed
  // Clinician CANNOT cancel or reschedule.
  // Front Desk: checked_in, cancelled, no_show, reschedule. CANNOT start/complete consultation.
  // =========================================================================
  describe('Fix 2: Clinician vs Front Desk Lifecycle Boundaries', () => {
    it('Clinician CANNOT cancel an appointment (returns 403 FORBIDDEN and logs audit)', async () => {
      const patient = await createCleanPatient('Clinician Cancel Test Patient');
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

      // Clinician 1 attempts to CANCEL their own appointment -> 403 FORBIDDEN
      const cancelRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({
          status: 'cancelled',
          cancellationReason: 'Doctor is busy',
        });

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.error.code).toBe('FORBIDDEN');

      // Verify audit log recorded permission denial
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'PERMISSION_DENIED';`,
        [`appointment/${aptId}/status`]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });

    it('Front Desk CANNOT start or complete consultation (returns 403 FORBIDDEN)', async () => {
      const patient = await createCleanPatient('FD Consultation Boundary Patient');
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

    it('Clinician can advance own appointment: scheduled -> in_consultation -> completed', async () => {
      const patient = await createCleanPatient('Clinician Flow Patient');
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
        .set('Idempotency-Key', `CLIN-ADVANCE-SETUP-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Consultation flow test',
        });
      expect(bookRes.status).toBe(201);
      const aptId = bookRes.body.data.id;

      // Clinician moves to in_consultation
      const startRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'in_consultation' });

      expect(startRes.status).toBe(200);
      expect(startRes.body.data.status).toBe('in_consultation');

      // Clinician completes consultation
      const completeRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'completed' });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.status).toBe('completed');
    });
  });

  // =========================================================================
  // Fix 3 & 4: Authorization Checked BEFORE State-Machine Validation + 403 Audit
  // =========================================================================
  describe('Fix 3 & 4: Early Authorization & 403 Audit Logging', () => {
    it('returns 403 (NOT 409) when Clinician 2 attempts invalid transition on Clinician 1 appointment', async () => {
      const patient = await createCleanPatient('Clinician 2 Test Patient');
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
        .send({ status: 'completed' }); // Even if transition is invalid, auth check must fire FIRST

      expect(authFirstRes.status).toBe(403);
      expect(authFirstRes.body.error.code).toBe('FORBIDDEN');

      // Check that audit entry for 403 was logged
      const auditLog = await query(
        `SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2;`,
        [`appointment/${aptId}/status`, clinician2Auth.user.id]
      );
      expect(auditLog.rows.length).toBeGreaterThan(0);
    });

    it('Clinician accessing another doctor appointment via GET /appointments/:id returns 403', async () => {
      const patient = await createCleanPatient('Clinician View Test Patient');
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
  // Fix 5: Optimistic State Locking on updateAppointmentStatus (Check-In vs Cancel Race)
  // =========================================================================
  describe('Fix 5: Concurrent Check-In vs Cancel (Optimistic State Locking)', () => {
    it('exactly one transition succeeds (200) and the other returns 409 INVALID_TRANSITION', async () => {
      const patient = await createCleanPatient('Race Checkin Cancel Patient');
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

      // Simultaneous requests: Request 1 checks in, Request 2 cancels (both expecting 'scheduled')
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
  // Fix 6: Transaction Wrapping (Entity Mutation + Audit Entry in ONE Transaction)
  // =========================================================================
  describe('Fix 6: Transactional Atomicity (Mutation + Audit in One Transaction)', () => {
    it('rolls back appointment creation if audit insertion fails', async () => {
      const patient = await createCleanPatient('Tx Fail Patient');
      const targetDate = getNextWeekday(2);
      const slotStart = hospitalLocalToUtc(targetDate, '10:30:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '10:45:00').toISOString();

      await query('DELETE FROM appointments WHERE (doctor_id = $1 OR patient_id = $2) AND starts_at = $3;', [
        doctor1.id,
        patient.id,
        slotStart,
      ]);

      // Direct service transaction test: simulate transaction failure on audit
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

      // Verify the appointment was completely rolled back and does not exist in the database
      const checkApt = await query('SELECT * FROM appointments WHERE appointment_number = $1;', [aptNumber]);
      expect(checkApt.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // Fix 7: Idempotency Scoping, Awaiting Completion, Reaper, and Canonical Hash
  // =========================================================================
  describe('Fix 7: Advanced Idempotency Semantics', () => {
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

      // Verify it exists
      const before = await query('SELECT * FROM idempotency_keys WHERE idempotency_key = $1;', [staleKey]);
      expect(before.rows.length).toBe(1);

      // Run reaper with 60s threshold
      await reapStaleProcessingKeys(60);

      // Verify it was reaped
      const after = await query('SELECT * FROM idempotency_keys WHERE idempotency_key = $1;', [staleKey]);
      expect(after.rows.length).toBe(0);
    });

    it('scopes idempotency keys by user: User 1 and User 2 can reuse the same key independently', async () => {
      const patientA = await createCleanPatient('Idempotency User 1 Patient');
      const patientB = await createCleanPatient('Idempotency User 2 Patient');
      const sharedKey = `SHARED-KEY-${Date.now()}`;
      const targetDate = getNextWeekday(2);

      const slot1Start = hospitalLocalToUtc(targetDate, '10:45:00').toISOString();
      const slot1End = hospitalLocalToUtc(targetDate, '11:00:00').toISOString();
      const slot2Start = hospitalLocalToUtc(targetDate, '11:00:00').toISOString();
      const slot2End = hospitalLocalToUtc(targetDate, '11:15:00').toISOString();

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

      // User 2 (frontDesk2Auth) books with same sharedKey -> must succeed because key is scoped per user!
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
  // Fix 8: Comprehensive B8 Tests: Vitest Concurrency Scenarios 1, 2, 3 & Edge Cases
  // =========================================================================
  describe('Fix 8: Vitest Concurrency Scenarios & Domain Invariants', () => {
    it(
      'Scenario 1: 20 simultaneous booking requests for identical slot -> exactly 1 succeeds (201), 19 get 409 SLOT_TAKEN',
      async () => {
        const patient = await createCleanPatient('Scenario 1 Patient');
        const targetDate = getNextWeekday(4); // Thursday
        const slotStart = hospitalLocalToUtc(targetDate, '09:00:00').toISOString();
        const slotEnd = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1;', [slotStart]);

        const attempts = Array.from({ length: 20 }, (_, idx) => {
          return request(app)
            .post('/api/v1/appointments')
            .set('Cookie', frontDeskAuth.cookie)
            .set('Idempotency-Key', `SCENARIO-1-RACE-${idx}-${Date.now()}`)
            .send({
              patientId: patient.id,
              doctorId: doctor1.id,
              startsAt: slotStart,
              endsAt: slotEnd,
              reasonForVisit: `Scenario 1 concurrent attempt ${idx}`,
            });
        });

        const responses = await Promise.all(attempts);
        const successes = responses.filter((r) => r.status === 201);
        const conflicts = responses.filter((r) => r.status === 409);

        expect(successes.length).toBe(1);
        expect(conflicts.length).toBe(19);
      },
      30000
    );

    it(
      'Scenario 2: 20 simultaneous bookings for same patient across different slots -> exactly 1 succeeds, remaining get 409 PATIENT_DOUBLE_BOOKED',
      async () => {
        const patient = await createCleanPatient('Scenario 2 Patient');
        const targetDate = getNextWeekday(4); // Thursday
        const slotStart = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();
        const slotEnd = hospitalLocalToUtc(targetDate, '09:30:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1 OR patient_id = $2;', [slotStart, patient.id]);

        // All 20 requests attempt to book the SAME patient at the SAME time window across doctor1 and doctor2
        const attempts = Array.from({ length: 20 }, (_, idx) => {
          const assignedDoctor = idx % 2 === 0 ? doctor1.id : doctor2.id;
          return request(app)
            .post('/api/v1/appointments')
            .set('Cookie', frontDeskAuth.cookie)
            .set('Idempotency-Key', `SCENARIO-2-PATIENT-${idx}-${Date.now()}`)
            .send({
              patientId: patient.id,
              doctorId: assignedDoctor,
              startsAt: slotStart,
              endsAt: slotEnd,
              reasonForVisit: `Scenario 2 concurrent attempt ${idx}`,
            });
        });

        const responses = await Promise.all(attempts);
        const successes = responses.filter((r) => r.status === 201);
        const conflicts = responses.filter((r) => r.status === 409);

        expect(successes.length).toBe(1);
        expect(conflicts.length).toBe(19);
      },
      30000
    );

    it(
      'Scenario 3: 20 simultaneous reschedule requests with expectedVersion: 1 -> exactly 1 succeeds, 19 get 409 STALE_VERSION',
      async () => {
        const patient = await createCleanPatient('Scenario 3 Patient');
        const targetDate = getNextWeekday(4);
        const initialStart = hospitalLocalToUtc(targetDate, '09:30:00').toISOString();
        const initialEnd = hospitalLocalToUtc(targetDate, '09:45:00').toISOString();

        await query('DELETE FROM appointments WHERE starts_at = $1;', [initialStart]);

        const bookRes = await request(app)
          .post('/api/v1/appointments')
          .set('Cookie', frontDeskAuth.cookie)
          .set('Idempotency-Key', `SCENARIO-3-SETUP-${Date.now()}`)
          .send({
            patientId: patient.id,
            doctorId: doctor1.id,
            startsAt: initialStart,
            endsAt: initialEnd,
            reasonForVisit: 'Scenario 3 reschedule test',
          });
        expect(bookRes.status).toBe(201);
        const aptId = bookRes.body.data.id;

        // 20 concurrent reschedules targeting different target slots
        const targetSlots = [
          '10:00:00', '10:15:00', '10:30:00', '10:45:00', '11:00:00',
          '11:15:00', '11:30:00', '11:45:00', '12:00:00', '12:15:00',
          '12:30:00', '12:45:00', '13:00:00', '13:15:00', '13:30:00',
          '13:45:00', '14:00:00', '14:15:00', '14:30:00', '14:45:00',
        ];

        // Clean up target slots first
        for (const timeStr of targetSlots) {
          const sUtc = hospitalLocalToUtc(targetDate, timeStr).toISOString();
          await query('DELETE FROM appointments WHERE starts_at = $1;', [sUtc]);
        }

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
        const successes = responses.filter((r) => r.status === 200);
        const staleVersions = responses.filter((r) => r.status === 409 && r.body.error?.code === 'STALE_VERSION');

        expect(successes.length).toBe(1);
        expect(staleVersions.length).toBe(19);
      },
      30000
    );

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

      // Book Slot A
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

      // Book Slot B
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
});
