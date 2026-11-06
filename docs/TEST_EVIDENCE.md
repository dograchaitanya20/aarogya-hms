# Aarogya HMS — Test Evidence & Execution Logs

This document provides verified test evidence executed against a real PostgreSQL 16 database.

## Test Summary

| Test File | Test Suite | Tests Run | Passed | Failed |
| :--- | :--- | :---: | :---: | :---: |
| [`tests/db.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/db.test.js) | Database Constraints & Triggers | 6 | 6 | 0 |
| [`tests/auth.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/auth.test.js) | Health & Authentication Endpoints | 10 | 10 | 0 |
| [`tests/rbac.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/rbac.test.js) | RBAC Matrix & Audit Enforcement | 19 | 19 | 0 |
| **Total** | **Full Backend Test Suite** | **35** | **35** | **0** |

---

## 1. Automated Vitest Suite Execution

**Command**:
```bash
npm test
```

**Raw Output**:
```text
> aarogya-hms@1.0.0 test
> npm --workspace=backend run test


> aarogya-hms-backend@1.0.0 test
> vitest run


 RUN  v3.2.7 C:/Users/ASUS/Downloads/aarogya-hms/backend

 ✓ tests/db.test.js (6 tests) 182ms
 ✓ tests/auth.test.js (10 tests) 414ms
 ✓ tests/rbac.test.js (19 tests) 592ms

 Test Files  3 passed (3)
      Tests  35 passed (35)
   Start at  23:46:09
   Duration  1.90s (transform 242ms, setup 0ms, collect 1.88s, tests 1.19s, environment 1ms, prepare 559ms)
```

---

## 2. Double-Booking Exclusion Constraint Evidence

PostgreSQL `btree_gist` exclusion constraint prevents concurrent double-booking at the storage engine level.

**Command**:
```bash
npm run demo:race
```

**Raw Output**:
```text
> aarogya-hms@1.0.0 demo:race
> npm --workspace=backend run demo:race


> aarogya-hms-backend@1.0.0 demo:race
> node scripts/demo-race.js

=== Aarogya HMS: Double-Booking Prevention Demo (PostgreSQL btree_gist) ===

Doctor:    Dr. Rajesh Sharma (ID: 4b2c4729-290a-4966-84af-9f9e6744c794)
Slot Time: 2026-12-21T17:30:00.000Z -> 2026-12-21T17:45:00.000Z
Patient 1: Nikhil Malhotra (MRN-2026-0013)
Patient 2: Pooja Narang (MRN-2026-0014)

--- Step 1: Booking Appointment 1 for Patient 1 ---
[SUCCESS] Appointment 1 booked: APT-RACE-001 (ID: bdac6c07-1305-4c9d-903b-4df9c935d087)

--- Step 2: Attempting to Book Overlapping Slot for Patient 2 ---
[BLOCKED] Database rejected double-booking as expected!
  SQLSTATE:   23P01
  Constraint: uq_doctor_slot_no_overlap
  Detail:     Key (doctor_id, tstzrange(starts_at, ends_at))=(4b2c4729-290a-4966-84af-9f9e6744c794, ["2026-12-21 17:30:00+00","2026-12-21 17:45:00+00")) conflicts with existing key (doctor_id, tstzrange(starts_at, ends_at))=(4b2c4729-290a-4966-84af-9f9e6744c794, ["2026-12-21 17:30:00+00","2026-12-21 17:45:00+00"])).
  Message:    conflicting key value violates exclusion constraint "uq_doctor_slot_no_overlap"

[DEMO PASSED] Exclusion constraint "uq_doctor_slot_no_overlap" successfully enforced!
```

---

## 3. Append-Only Audit Trigger Evidence

**Test Case**: `UPDATE` and `DELETE` queries executed against `audit_log` are trapped by database trigger `trg_audit_log_append_only`.

**Result**:
- `UPDATE audit_log SET action = 'MODIFIED_ACTION' WHERE id = ...` &rarr; Rejection with SQLSTATE `55000` (`audit_log is append-only: UPDATE and DELETE operations are forbidden`).
- `DELETE FROM audit_log WHERE id = ...` &rarr; Rejection with SQLSTATE `55000` (`audit_log is append-only: UPDATE and DELETE operations are forbidden`).

---

## 4. RBAC Matrix Verification Evidence

| Resource | Action | Role Tested | Expected | Actual Result | Audit Action Written |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Directory** | Create Dept | Admin | 201 | 201 Created | `CREATE_DEPARTMENT` |
| **Directory** | Create Dept | Clinician | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Directory** | Create Dept | Front Desk | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Directory** | List Depts | All Roles | 200 | 200 OK | - |
| **Patients** | Create Patient | Front Desk | 201 | 201 Created | `CREATE_PATIENT` |
| **Patients** | Create Patient | Admin | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Patients** | Create Patient | Clinician | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Patients** | List Patients | Front Desk | 200 | 200 OK | `READ_PATIENT_LIST` |
| **Clinical Notes** | Read Notes | Treating Clinician | 200 | 200 OK | `READ_CLINICAL_NOTE` |
| **Clinical Notes** | Read Notes | Untreated Clinician | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Clinical Notes** | Read Notes | Admin | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Clinical Notes** | Read Notes | Front Desk | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Billing** | List Invoices | Admin | 200 | 200 OK | - |
| **Billing** | List Invoices | Front Desk | 200 | 200 OK | - |
| **Billing** | List Invoices | Clinician | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Audit Logs** | View Logs | Admin | 200 | 200 OK | - |
| **Audit Logs** | View Logs | Clinician | 403 | 403 Forbidden | `PERMISSION_DENIED` |
| **Audit Logs** | View Logs | Front Desk | 403 | 403 Forbidden | `PERMISSION_DENIED` |
