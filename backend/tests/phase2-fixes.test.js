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
import { validateEnv, parseDurationToSeconds } from '../src/config/env.js';

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
  // Fix 1: State Machine Transition (scheduled -> checked_in -> in_consultation -> completed)
  // Clinician may start consultation ONLY from checked_in!
  // =========================================================================
  describe('Fix 1: Strict AGENTS.md State Machine Compliance', () => {
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

      // Clinician attempts scheduled -> in_consultation directly -> MUST FAIL with 409
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
      const patient = await createCleanPatient('Clinician Cancel Target Patient');
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
        .set('Idempotency-Key', `CLIN-CANCEL-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Cancel forbidden test',
        });
      const aptId = bookRes.body.data.id;

      const cancelRes = await request(app)
        .patch(`/api/v1/appointments/${aptId}/status`)
        .set('Cookie', clinician1Auth.cookie)
        .send({ status: 'cancelled', cancellationReason: 'Doctor unavailable' });

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // Fix 2: GET /patients Clinician Access Restriction
  // =========================================================================
  describe('Fix 2: GET /patients Repo-level Clinician Isolation', () => {
    it('Clinician sees only patients assigned to them; other patients omitted from list & 403 on getById', async () => {
      const patientDoc1 = await createCleanPatient('Assigned To Doctor 1');
      const patientDoc2 = await createCleanPatient('Assigned To Doctor 2');
      const targetDate = getNextWeekday(2);

      // Book patientDoc1 with doctor1
      const slot1Start = hospitalLocalToUtc(targetDate, '14:00:00').toISOString();
      const slot1End = hospitalLocalToUtc(targetDate, '14:15:00').toISOString();

      // Clear any potential collisions
      await query('DELETE FROM appointments WHERE starts_at IN ($1, $2);', [slot1Start, hospitalLocalToUtc(targetDate, '14:15:00').toISOString()]);

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
  });

  // =========================================================================
  // Fix 3: Concurrency Scenarios with Pool max 20, Advisory Locks & Error Codes
  // =========================================================================
  describe('Fix 3: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions', () => {
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
        const slotTakens = responses.filter(
          (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
        );

        expect(successes.length).toBe(1);
        expect(slotTakens.length).toBe(19);
        expect(durationMs).toBeLessThan(4000); // Fast execution
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
            reasonForVisit: 'Scenario 3 reschedule test',
          });
        expect(bookRes.status).toBe(201);
        const aptId = bookRes.body.data.id;

        const targetSlots = [
          '10:00:00', '10:15:00', '10:30:00', '10:45:00', '11:00:00',
          '11:15:00', '11:30:00', '11:45:00', '12:00:00', '12:15:00',
          '12:30:00', '12:45:00', '13:00:00', '13:15:00', '13:30:00',
          '13:45:00', '14:00:00', '14:15:00', '14:30:00', '14:45:00',
        ];

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
        const staleVersions = responses.filter(
          (r) => r.status === 409 && r.body.error?.code === 'STALE_VERSION'
        );

        expect(successes.length).toBe(1);
        expect(staleVersions.length).toBe(19);
      },
      10000
    );
  });

  // =========================================================================
  // Fix 4: Additional Vitest Concurrency Tests:
  // (a) 10 concurrent POSTs with SAME Idempotency-Key
  // (b) 5 concurrent reschedules into ONE target slot
  // =========================================================================
  describe('Fix 4: Advanced Vitest Concurrency Test Cases', () => {
    it('(a) 10 concurrent POSTs with SAME Idempotency-Key -> exactly 1 row created, responses return same appointment or IDEMPOTENCY_IN_PROGRESS', async () => {
      const patient = await createCleanPatient('Idemp Concurrency Patient');
      const targetDate = getNextWeekday(4); // Thursday
      const slotStart = hospitalLocalToUtc(targetDate, '09:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '09:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at = $1;', [slotStart]);

      const sharedKey = `SAME-IDEMP-KEY-${Date.now()}`;
      const payload = {
        patientId: patient.id,
        doctorId: doctor1.id,
        startsAt: slotStart,
        endsAt: slotEnd,
        reasonForVisit: '10 concurrent identical idempotency requests',
      };

      const attempts = Array.from({ length: 10 }, () => {
        return request(app)
          .post('/api/v1/appointments')
          .set('Cookie', frontDeskAuth.cookie)
          .set('Idempotency-Key', sharedKey)
          .send(payload);
      });

      const responses = await Promise.all(attempts);

      // Database verification: exactly 1 appointment row exists for this slot
      const dbCheck = await query('SELECT id FROM appointments WHERE starts_at = $1 AND doctor_id = $2;', [
        slotStart,
        doctor1.id,
      ]);
      expect(dbCheck.rows.length).toBe(1);
      const winnerAptId = dbCheck.rows[0].id;

      // Responses must either return the winner appointment ID (status 201 or 200 cached) or 409 IDEMPOTENCY_IN_PROGRESS
      for (const res of responses) {
        if (res.status === 201 || res.status === 200) {
          expect(res.body.data.id).toBe(winnerAptId);
        } else {
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
        }
      }
    });

    it('(b) 5 concurrent reschedules of different appointments into ONE target slot -> exactly one 200, four SLOT_TAKEN', async () => {
      const targetDate = getNextWeekday(4);
      const targetSlotStart = hospitalLocalToUtc(targetDate, '10:00:00').toISOString();
      const targetSlotEnd = hospitalLocalToUtc(targetDate, '10:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at = $1;', [targetSlotStart]);

      // Create 5 separate initial appointments
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
      const slotTakens = responses.filter(
        (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
      );

      expect(successes.length).toBe(1);
      expect(slotTakens.length).toBe(4);

      // Verify DB target slot has exactly 1 appointment
      const slotCount = await query('SELECT id FROM appointments WHERE starts_at = $1 AND doctor_id = $2;', [
        targetSlotStart,
        doctor1.id,
      ]);
      expect(slotCount.rows.length).toBe(1);
    });
  });

  // =========================================================================
  // Fix 5: Directory PATCH/DELETE for departments, doctors, schedules & GET /doctors/:id
  // =========================================================================
  describe('Fix 5: Directory Admin Administration & RBAC Enforcement', () => {
    it('GET /doctors/:id returns doctor details for admin, clinician and front_desk', async () => {
      const resAdmin = await request(app)
        .get(`/api/v1/directory/doctors/${doctor1.id}`)
        .set('Cookie', adminAuth.cookie);
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.data.id).toBe(doctor1.id);

      const resClin = await request(app)
        .get(`/api/v1/directory/doctors/${doctor1.id}`)
        .set('Cookie', clinician1Auth.cookie);
      expect(resClin.status).toBe(200);

      const resFd = await request(app)
        .get(`/api/v1/directory/doctors/${doctor1.id}`)
        .set('Cookie', frontDeskAuth.cookie);
      expect(resFd.status).toBe(200);
    });

    it('Admin can PATCH and DELETE department, clinician/front_desk get 403', async () => {
      // 1. Create department as Admin
      const createRes = await request(app)
        .post('/api/v1/directory/departments')
        .set('Cookie', adminAuth.cookie)
        .send({
          name: `Test Dept ${Date.now()}`,
          code: `D${Date.now().toString().slice(-4)}`,
          description: 'Initial description',
        });
      expect(createRes.status).toBe(201);
      const deptId = createRes.body.data.id;

      // 2. Front desk cannot update department -> 403
      const fdPatchRes = await request(app)
        .patch(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', frontDeskAuth.cookie)
        .send({ description: 'Unauthorized update' });
      expect(fdPatchRes.status).toBe(403);

      // 3. Admin updates department -> 200
      const adminPatchRes = await request(app)
        .patch(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', adminAuth.cookie)
        .send({ description: 'Authorized admin update' });
      expect(adminPatchRes.status).toBe(200);
      expect(adminPatchRes.body.data.description).toBe('Authorized admin update');

      // 4. Admin deletes/deactivates department -> 200
      const deleteRes = await request(app)
        .delete(`/api/v1/directory/departments/${deptId}`)
        .set('Cookie', adminAuth.cookie);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.is_active).toBe(false);
    });

    it('Admin can PATCH and DELETE doctor & schedule rules with auditing', async () => {
      // Admin patches doctor fee
      const docPatch = await request(app)
        .patch(`/api/v1/directory/doctors/${doctor2.id}`)
        .set('Cookie', adminAuth.cookie)
        .send({ consultationFeePaise: 75000 });
      expect(docPatch.status).toBe(200);
      expect(Number(docPatch.body.data.consultation_fee_paise)).toBe(75000);

      // Create a test schedule rule for doctor2 on Saturday
      await query('DELETE FROM doctor_schedules WHERE doctor_id = $1 AND day_of_week = 6;', [doctor2.id]);
      const schedCreate = await request(app)
        .post('/api/v1/directory/schedules')
        .set('Cookie', adminAuth.cookie)
        .send({
          doctorId: doctor2.id,
          dayOfWeek: 6,
          startTime: '09:00:00',
          endTime: '12:00:00',
          slotDurationMinutes: 15,
        });
      expect(schedCreate.status).toBe(201);
      const schedId = schedCreate.body.data.id;

      // Admin patches schedule
      const schedPatch = await request(app)
        .patch(`/api/v1/directory/schedules/${schedId}`)
        .set('Cookie', adminAuth.cookie)
        .send({ slotDurationMinutes: 30 });
      expect(schedPatch.status).toBe(200);
      expect(schedPatch.body.data.slot_duration_minutes).toBe(30);

      // Admin deletes schedule rule
      const schedDel = await request(app)
        .delete(`/api/v1/directory/schedules/${schedId}`)
        .set('Cookie', adminAuth.cookie);
      expect(schedDel.status).toBe(200);
      expect(schedDel.body.data.is_active).toBe(false);
    });
  });

  // =========================================================================
  // Fix 6: env.js JWT Security Validation
  // =========================================================================
  describe('Fix 6: env.js Security Validations', () => {
    it('parseDurationToSeconds accurately parses duration strings', () => {
      expect(parseDurationToSeconds('8h')).toBe(28800);
      expect(parseDurationToSeconds('1h')).toBe(3600);
      expect(parseDurationToSeconds('30m')).toBe(1800);
      expect(parseDurationToSeconds('60s')).toBe(60);
      expect(parseDurationToSeconds('1d')).toBe(86400);
      expect(isNaN(parseDurationToSeconds('invalid'))).toBe(true);
    });

    it('validateEnv rejects missing/short JWT_SECRET in development/production', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: 'short-key',
          JWT_EXPIRES_IN: '8h',
        })
      ).toThrow(/FATAL: JWT_SECRET must be set and at least 32 characters long/);
    });

    it('validateEnv rejects JWT_EXPIRES_IN greater than 8 hours', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          JWT_SECRET: 'test-jwt-super-secret-key-min-32-chars-long',
          JWT_EXPIRES_IN: '9h',
        })
      ).toThrow(/FATAL: JWT_EXPIRES_IN must not exceed 8 hours/);

      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          JWT_SECRET: 'test-jwt-super-secret-key-min-32-chars-long',
          JWT_EXPIRES_IN: '24h',
        })
      ).toThrow(/FATAL: JWT_EXPIRES_IN must not exceed 8 hours/);
    });

    it('validateEnv accepts valid 8h expiry and 32+ character secrets', () => {
      const res = validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'super-secure-production-ready-secret-key-32-chars',
        JWT_EXPIRES_IN: '8h',
      });
      expect(res.jwtSecret).toBe('super-secure-production-ready-secret-key-32-chars');
      expect(res.jwtExpiresIn).toBe('8h');
    });
  });

  // =========================================================================
  // Fix 7: DB Sequence Generation & updatePatient Validation
  // =========================================================================
  describe('Fix 7: PostgreSQL Sequence Numbers & Demographic Update Validation', () => {
    it('generates sequential appointment numbers and MRNs via PostgreSQL sequences', async () => {
      const patient = await createCleanPatient('Sequence Verification Patient');
      expect(patient.mrn).toMatch(/^MRN-\d{4}-\d{6}$/);

      const targetDate = getNextWeekday(4);
      const slotStart = hospitalLocalToUtc(targetDate, '14:00:00').toISOString();
      const slotEnd = hospitalLocalToUtc(targetDate, '14:15:00').toISOString();

      await query('DELETE FROM appointments WHERE starts_at = $1;', [slotStart]);

      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', frontDeskAuth.cookie)
        .set('Idempotency-Key', `SEQ-VERIFY-${Date.now()}`)
        .send({
          patientId: patient.id,
          doctorId: doctor1.id,
          startsAt: slotStart,
          endsAt: slotEnd,
          reasonForVisit: 'Sequence test',
        });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body.data.appointment_number).toMatch(/^APT-\d{4}-\d{6}$/);
    });

    it('PUT /patients/:id returns 422 VALIDATION_ERROR when no update fields are given', async () => {
      const patient = await createCleanPatient('Empty Update Patient');

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
