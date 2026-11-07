# Aarogya HMS — Test Evidence & Execution Logs

This document provides verified test evidence executed against a real PostgreSQL 16 database.

## Test Summary

| Test File | Test Suite | Tests Run | Passed | Failed |
| :--- | :--- | :---: | :---: | :---: |
| [`tests/timezone.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/timezone.test.js) | Hospital Timezone (`Asia/Kolkata`) Engine | 5 | 5 | 0 |
| [`tests/db.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/db.test.js) | Database Constraints & Append-Only Triggers | 6 | 6 | 0 |
| [`tests/security-isolation.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/security-isolation.test.js) | DB Isolation Proof & Security Hardening | 5 | 5 | 0 |
| [`tests/auth.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/auth.test.js) | Health & Authentication Endpoints | 10 | 10 | 0 |
| [`tests/rbac.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/rbac.test.js) | RBAC Matrix & Audit Log Enforcement | 19 | 19 | 0 |
| [`tests/phase2.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/phase2.test.js) | Appointments, Slots, Idempotency & Concurrency | 13 | 13 | 0 |
| [`tests/phase2-fixes.test.js`](file:///c:/Users/ASUS/Downloads/aarogya-hms/backend/tests/phase2-fixes.test.js) | Full Phase 2 Close-Out & Concurrency Suite (All Restored + New Tests) | 32 | 32 | 0 |
| **Total** | **Full Backend Test Suite** | **90** | **90** | **0** |

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

[Test Setup] Ensuring test database is migrated and seeded...
[Migrate] Database is already up to date. No new migrations.
[Seed] Starting idempotent synthetic data seed...
[Seed] Seeding 60 appointments...
[Seed] Database seed completed successfully!
[Test Setup] Test database ready.
 ✓ tests/timezone.test.js (5 tests) 39ms
 ✓ tests/db.test.js (6 tests) 209ms
 ✓ tests/security-isolation.test.js (5 tests) 123ms
 ✓ tests/auth.test.js (10 tests) 444ms
 ✓ tests/rbac.test.js (19 tests) 633ms
 ✓ tests/phase2.test.js (13 tests) 829ms
 ✓ tests/phase2-fixes.test.js (32 tests) 2298ms

 Test Files  7 passed (7)
      Tests  90 passed (90)
   Duration  4.47s
```

---

## 2. Real HTTP Concurrent Race Demo Output

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

=== Aarogya HMS: Concurrent HTTP Race Demo (PostgreSQL btree_gist) ===

[Server] Live test server listening on http://localhost:50251
[Auth] Authenticated as front-desk successfully.

--- SCENARIO 1: 20 Simultaneous HTTP Bookings for the Same Doctor+Slot ---
Doctor: Dr. Rajesh Sharma (e01db3c1-8b84-4914-98bb-128b73adb60c)
Slot:   2027-01-11T04:30:00.000Z -> 2027-01-11T04:45:00.000Z (10:00 - 10:15 IST)
Firing 20 simultaneous HTTP POST requests with 20 distinct patients...

Scenario 1 Status Code Breakdown:
  HTTP 201: 1
  HTTP 409: 19
[PASSED] Winner Appointment ID: 5490d327-9d8c-48d4-9e5b-8a92d37d75c6 (APT-468750-819)

--- SCENARIO 2: 10 Concurrent Requests with the SAME Idempotency-Key ---
Key:  race-sc2-shared-key-1793990453402
Firing 10 concurrent HTTP POST requests with exact same Idempotency-Key...
Appointments in Database for slot: 1
[PASSED] Exactly 1 appointment row created; duplicate requests handled idempotently.

--- SCENARIO 3: 5 Concurrent Reschedules into the Same Target Slot ---
Created 5 appointments. Now attempting concurrent reschedule to: 2027-01-11T08:30:00.000Z
Scenario 3 Status Code Breakdown:
  HTTP 200: 1
  HTTP 409: 4
[PASSED] Exactly 1 reschedule succeeded into target slot; 4 rejected with 409.

[Cleanup] Demo test data cleaned up successfully.

=== ALL CONCURRENCY & RACE SCENARIOS PASSED WITH RIGOROUS ASSERTIONS ===
```

---

## 3. Database Isolation Verification

**Evidence from `tests/security-isolation.test.js`**:
- `SELECT current_database()` returns `aarogya_hms_test`.
- Dev DB row counts before running test: 40 patients.
- Row inserted into `aarogya_hms_test`: 1 row.
- Dev DB row counts after test: 40 patients (0 mutations to dev DB).
