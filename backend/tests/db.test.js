import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, pool } from '../src/config/db.js';
import { deleteAppointmentsWhere } from './helpers.js';

describe('Database Integrity & Constraints', () => {
  let doctorId;
  let departmentId;
  let patient1Id;
  let patient2Id;
  let createdBy;

  beforeAll(async () => {
    const doc = await query('SELECT d.id, d.department_id FROM doctors d LIMIT 1;');
    const patients = await query('SELECT id FROM patients LIMIT 2;');
    const user = await query('SELECT id FROM users LIMIT 1;');

    doctorId = doc.rows[0].id;
    departmentId = doc.rows[0].department_id;
    patient1Id = patients.rows[0].id;
    patient2Id = patients.rows[1].id;
    createdBy = user.rows[0].id;
  });

  afterAll(async () => {
    await deleteAppointmentsWhere("appointment_number LIKE 'TEST-APT-%'");
  });

  describe('PostgreSQL btree_gist Exclusion Constraint (Double-Booking Prevention)', () => {
    it('should reject an overlapping appointment inserted directly via SQL with SQLSTATE 23P01', async () => {
      const slotStart = new Date(Date.now() + 60 * 24 * 3600 * 1000);
      slotStart.setMinutes(0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      // 1. Insert primary booking
      const res1 = await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Routine checkup', $7)
        RETURNING id;
        `,
        ['TEST-APT-001', patient1Id, doctorId, departmentId, slotStart.toISOString(), slotEnd.toISOString(), createdBy]
      );
      expect(res1.rows[0].id).toBeDefined();

      // 2. Attempt exact overlapping booking for the same doctor
      let caughtError = null;
      try {
        await query(
          `
          INSERT INTO appointments (
            appointment_number, patient_id, doctor_id, department_id,
            starts_at, ends_at, status, reason_for_visit, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Conflicting booking', $7)
          RETURNING id;
          `,
          ['TEST-APT-002', patient2Id, doctorId, departmentId, slotStart.toISOString(), slotEnd.toISOString(), createdBy]
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('23P01'); // 23P01 is PostgreSQL exclusion_violation
      expect(caughtError.constraint).toBe('uq_doctor_slot_no_overlap');
    });

    it('should reject a partial overlapping slot (starts 5 minutes into existing appointment)', async () => {
      const slotStart = new Date(Date.now() + 61 * 24 * 3600 * 1000);
      slotStart.setMinutes(0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Routine checkup', $7);
        `,
        ['TEST-APT-PARTIAL-1', patient1Id, doctorId, departmentId, slotStart.toISOString(), slotEnd.toISOString(), createdBy]
      );

      // Overlapping slot: starts 5 mins in, ends 20 mins in
      const partialStart = new Date(slotStart.getTime() + 5 * 60 * 1000);
      const partialEnd = new Date(slotStart.getTime() + 20 * 60 * 1000);

      let caughtError = null;
      try {
        await query(
          `
          INSERT INTO appointments (
            appointment_number, patient_id, doctor_id, department_id,
            starts_at, ends_at, status, reason_for_visit, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Conflicting booking', $7);
          `,
          ['TEST-APT-PARTIAL-2', patient2Id, doctorId, departmentId, partialStart.toISOString(), partialEnd.toISOString(), createdBy]
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('23P01');
    });

    it('should allow adjacent back-to-back appointment slots (tstzrange [) boundary behavior)', async () => {
      const slot1Start = new Date(Date.now() + 62 * 24 * 3600 * 1000);
      slot1Start.setMinutes(0, 0, 0);
      const slot1End = new Date(slot1Start.getTime() + 15 * 60 * 1000); // 09:00 -> 09:15

      const slot2Start = new Date(slot1End); // 09:15 -> 09:30 (starts exactly when slot 1 ends)
      const slot2End = new Date(slot2Start.getTime() + 15 * 60 * 1000);

      const res1 = await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Slot 1', $7)
        RETURNING id;
        `,
        ['TEST-APT-ADJACENT-1', patient1Id, doctorId, departmentId, slot1Start.toISOString(), slot1End.toISOString(), createdBy]
      );

      const res2 = await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Slot 2', $7)
        RETURNING id;
        `,
        ['TEST-APT-ADJACENT-2', patient2Id, doctorId, departmentId, slot2Start.toISOString(), slot2End.toISOString(), createdBy]
      );

      expect(res1.rows[0].id).toBeDefined();
      expect(res2.rows[0].id).toBeDefined();
    });

    it('should allow re-booking a slot if previous appointment was cancelled or no_show', async () => {
      const slotStart = new Date(Date.now() + 63 * 24 * 3600 * 1000);
      slotStart.setMinutes(0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      // Cancelled appointment
      await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, cancellation_reason, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'cancelled', 'Patient had emergency', $7);
        `,
        ['TEST-APT-CANCELLED-1', patient1Id, doctorId, departmentId, slotStart.toISOString(), slotEnd.toISOString(), createdBy]
      );

      // New appointment on the exact same slot should succeed
      const newRes = await query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Replacement booking', $7)
        RETURNING id;
        `,
        ['TEST-APT-REPLACEMENT-1', patient2Id, doctorId, departmentId, slotStart.toISOString(), slotEnd.toISOString(), createdBy]
      );

      expect(newRes.rows[0].id).toBeDefined();
    });
  });

  describe('Append-Only Audit Log Trigger', () => {
    let testAuditId;

    beforeAll(async () => {
      const res = await query(
        `
        INSERT INTO audit_log (action, entity_type, entity_id, ip_address, request_id)
        VALUES ('TEST_ACTION', 'test_entity', 'test-123', '127.0.0.1', 'req-test-123')
        RETURNING id;
        `
      );
      testAuditId = res.rows[0].id;
    });

    it('should reject UPDATE on audit_log with trigger exception', async () => {
      let caughtError = null;
      try {
        await query("UPDATE audit_log SET action = 'MODIFIED_ACTION' WHERE id = $1", [testAuditId]);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('55000');
      expect(caughtError.message).toContain('audit_log is append-only');
    });

    it('should reject DELETE on audit_log with trigger exception', async () => {
      let caughtError = null;
      try {
        await query('DELETE FROM audit_log WHERE id = $1', [testAuditId]);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('55000');
      expect(caughtError.message).toContain('audit_log is append-only');
    });
  });
});
