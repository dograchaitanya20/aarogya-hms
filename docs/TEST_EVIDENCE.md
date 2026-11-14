# Aarogya HMS — Test Evidence & Execution Logs

Everything below is raw output captured from a **clean-slate run**: both databases dropped and recreated, then `migrate`, `seed` (twice), the full test suite, and the race demo.

**Environment of this capture:** Linux (Ubuntu 24.04), Node v22.23.4, PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) from the distro packages (no Docker in this environment; `docker compose up -d` provisions the same PostgreSQL 16 for reviewers). Re-run the commands in the README on your own machine for an independent result.

## Summary

| | |
|---|---|
| Test files | 10 backend + 3 frontend (13 total) |
| Tests | 188 total (156 backend + 32 frontend) |
| Passed | 188 |
| Failed | 0 |
| Database | real PostgreSQL, isolated `aarogya_hms_test`; the database layer is never mocked |

| File | Tests | Passed |
|---|---|---|
| `backend: architecture.test.js` | 4 | 4 |
| `backend: auth.test.js` | 10 | 10 |
| `backend: db.test.js` | 6 | 6 |
| `backend: openapi-coverage.test.js` | 5 | 5 |
| `backend: phase2-fixes.test.js` | 33 | 33 |
| `backend: phase2.test.js` | 13 | 13 |
| `backend: phase3-clinical-billing.test.js` | 54 | 54 |
| `backend: rbac.test.js` | 19 | 19 |
| `backend: security-isolation.test.js` | 7 | 7 |
| `backend: timezone.test.js` | 5 | 5 |
| `frontend: tests/api.test.js` | 9 | 9 |
| `frontend: tests/format.test.js` | 9 | 9 |
| `frontend: tests/e2e.test.jsx` | 14 | 14 |

Some tests deliberately make one dependency fail (for example the audit write) with `vi.spyOn` to prove a transaction rolls back. That is fault injection on top of the real database, not a substitute for it.

## 1. Migrations (fresh database)
```text
[Migrate] Applying migration: 001_initial_schema.sql...
[Migrate] Applied 001_initial_schema.sql successfully in 268ms
[Migrate] Applying migration: 002_patient_exclusion_and_idempotency.sql...
[Migrate] Applied 002_patient_exclusion_and_idempotency.sql successfully in 4ms
[Migrate] Applying migration: 003_idempotency_user_scope.sql...
[Migrate] Applied 003_idempotency_user_scope.sql successfully in 4ms
[Migrate] Applying migration: 004_sequences_for_mrn_and_appointments.sql...
[Migrate] Applied 004_sequences_for_mrn_and_appointments.sql successfully in 3ms
[Migrate] Applying migration: 005_nullable_encounter_appointment.sql...
[Migrate] Applied 005_nullable_encounter_appointment.sql successfully in 1ms
[Migrate] Applying migration: 006_billing_sequences_and_invoice_uniqueness.sql...
[Migrate] Applied 006_billing_sequences_and_invoice_uniqueness.sql successfully in 5ms
[Migrate] Applying migration: 007_dedupe_seeded_invoice_items.sql...
[Migrate] Applied 007_dedupe_seeded_invoice_items.sql successfully in 3ms
[Migrate] Successfully applied 7 migration(s).
```

## 2. Seed, run twice (idempotency proof)
```text
[Seed] Starting idempotent synthetic data seed...
[Seed] Seeding 60 appointments...
[Seed] Database seed completed successfully!
```
After the **second** seed run, the number of invoices with duplicated line items is **0**. Earlier the seed duplicated invoice items on every run: the reconciliation test caught it (invoice `INV-2026-00001` had a total of 126000 paise but items summing to 240000), the seed was fixed, and migration `007` repairs databases already affected.

## 3. Concurrent HTTP race demo (`npm run demo:race`, exit code 0)
```text
=== Aarogya HMS: Concurrent HTTP Race Demo (PostgreSQL btree_gist) ===
[Server] Live test server listening on http://localhost:41331
[Auth] Authenticated as front-desk successfully.
--- SCENARIO 1: 20 Simultaneous HTTP Bookings for the Same Doctor+Slot ---
Doctor: Dr. Rajesh Sharma (764b48ae-bdb5-4639-9011-34906b4db387)
Slot:   2027-01-11T04:30:00.000Z -> 2027-01-11T04:45:00.000Z (10:00 - 10:15 IST)
Firing 20 simultaneous HTTP POST requests with 20 distinct patients...
[2026-11-09 09:01:46.884 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.080 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.181 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.208 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.237 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.252 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.285 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.286 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.301 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.306 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.311 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.319 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.321 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.324 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.329 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.338 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.341 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.346 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.348 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.351 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.354 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
Scenario 1 Status Code Breakdown:
  HTTP 201: 1
  HTTP 409: 19
[PASSED] Winner Appointment ID: b61a103e-39c3-41b4-8466-104faac1bf27 (APT-2026-100001); all 19 rejections verified with error.code='SLOT_TAKEN'
--- SCENARIO 2: 10 Concurrent Requests with the SAME Idempotency-Key ---
Key:  race-sc2-shared-key-1794214907356
Firing 10 concurrent HTTP POST requests with exact same Idempotency-Key...
Appointments in Database for slot: 1
Scenario 2 Response Breakdown: {"201":1,"409 IDEMPOTENCY_IN_PROGRESS":9}
[PASSED] Exactly 1 appointment row created; duplicate requests handled idempotently.
--- SCENARIO 3: 5 Concurrent Reschedules into the Same Target Slot ---
[2026-11-09 09:01:47.395 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.395 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.396 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.396 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.397 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.397 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.399 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.402 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.402 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.407 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.415 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.425 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.433 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.450 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
Created 5 appointments. Now attempting concurrent reschedule to: 2027-01-11T08:30:00.000Z
[2026-11-09 09:01:47.461 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.493 +0000] [32mINFO[39m: [36mHTTP Request Completed[39m
[2026-11-09 09:01:47.494 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.497 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.499 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
[2026-11-09 09:01:47.502 +0000] [33mWARN[39m: [36mHTTP Request Warning[39m
Scenario 3 Status Code Breakdown:
  HTTP 200: 1
  HTTP 409: 4
[PASSED] Exactly 1 reschedule succeeded into target slot; 4 rejected with error.code='SLOT_TAKEN'.
[Cleanup] Demo test data cleaned up successfully.
=== ALL CONCURRENCY & RACE SCENARIOS PASSED WITH RIGOROUS ASSERTIONS ===
```
Scenario 2 shows the idempotency contract precisely: one request executes (`201`), the nine concurrent duplicates receive `409 IDEMPOTENCY_IN_PROGRESS`, and exactly one appointment row exists. The same scenarios (plus 10 concurrent payments and 10 concurrent same-key payments) also run as Vitest integration tests.

## 4. Proof that key tests can fail (mutation checks)
Each guarded behaviour was deliberately broken, the test was run and failed, then the original code was restored (verified byte-for-byte) and the test passed again.
```text
### Mutation A: appointment INSERT bypasses the transaction
-- broken:
     → expected 1 to be +0 // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
-- restored:
      Tests  1 passed | 32 skipped (33)

### Mutation B: deactivating a doctor no longer revokes access
-- broken:
     → expected 200 to be 401 // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
-- restored:
      Tests  1 passed | 53 skipped (54)

### Mutation C: rate limiter answers 200 instead of 429
-- broken:
     → expected [ 200, 200, 200, 200, 200 ] to deeply equal [ 200, 200, 200, 429, 429 ]
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
-- restored:
      Tests  1 passed | 6 skipped (7)
```
- **A**: the appointment INSERT ignores the transaction. With the audit write forced to fail, one orphan row remains.
- **B**: both access-revocation guards removed. A deactivated doctor's old session still gets `200` instead of `401`, which is the original vulnerability.
- **C**: the rate limiter answers `200` instead of `429`.

## 5. Tests that were found to be weak and replaced
A review of the suite found tests that could not fail, and they were replaced rather than left as false assurance:
- The "rate limiter returns 429" test built a sample object and asserted its own fields. It never ran the limiter. Replaced with a test that sends requests through a real limiter until it blocks, and one that checks the real login route is behind it.
- The "error responses never leak stack traces or SQL" test sent an invalid token, so the request was rejected with `401` before any error path ran. Replaced with a test that forces genuine database and internal errors and asserts the response contains no SQL, stack, file path or error message.
- The old audit-rollback test ran its own hand-written transaction in the test, so it proved Postgres rolls back, not that the service is atomic. It was kept, but a service-level test now calls `POST /appointments` with the real audit write failing (see mutation A).

## 6. Database isolation
`tests/security-isolation.test.js` proves the test pool is connected to `aarogya_hms_test`, and that a row written there does not appear in the development database `aarogya_hms`. Tests use only `TEST_DATABASE_URL`; the test JWT secret comes from `vitest.config.js`, never from source. The scope of that proof is the test pool and one table; it does not enumerate every table of the development database.

## 7. Every test, by file
<details><summary>Show all 156 test names</summary>

**architecture.test.js**
- Architecture guards no route, controller, service or middleware touches the database layer directly
- Architecture guards no raw SQL statements outside repositories
- Architecture guards no hardcoded secrets or fallback credentials in source
- Architecture guards routes never leak implementation details: no console.log in source (structured logger only)
**auth.test.js**
- Health & Authentication Endpoints GET /api/v1/health should return 200 OK with connected database status
- Health & Authentication Endpoints POST /api/v1/auth/login should successfully authenticate user with valid credentials and set httpOnly cookie
- Health & Authentication Endpoints POST /api/v1/auth/login should return 401 UNAUTHORIZED on wrong password and write audit log
- Health & Authentication Endpoints POST /api/v1/auth/login should return 401 UNAUTHORIZED for non-existent email and write audit log
- Health & Authentication Endpoints POST /api/v1/auth/login should return 422 VALIDATION_ERROR for malformed request body
- Health & Authentication Endpoints GET /api/v1/auth/me should return user profile when authenticated with cookie
- Health & Authentication Endpoints GET /api/v1/auth/me should return 401 UNAUTHORIZED when no token or cookie provided
- Health & Authentication Endpoints GET /api/v1/auth/me should return 401 UNAUTHORIZED when given a malformed or forged JWT token
- Health & Authentication Endpoints GET /api/v1/auth/me should reject login and me endpoints if user is marked inactive (is_active = false)
- Health & Authentication Endpoints POST /api/v1/auth/logout should successfully clear cookie and audit logout
**db.test.js**
- Database Integrity & Constraints PostgreSQL btree_gist Exclusion Constraint (Double-Booking Prevention) should reject an overlapping appointment inserted directly via SQL with SQLSTATE 23P01
- Database Integrity & Constraints PostgreSQL btree_gist Exclusion Constraint (Double-Booking Prevention) should reject a partial overlapping slot (starts 5 minutes into existing appointment)
- Database Integrity & Constraints PostgreSQL btree_gist Exclusion Constraint (Double-Booking Prevention) should allow adjacent back-to-back appointment slots (tstzrange [) boundary behavior)
- Database Integrity & Constraints PostgreSQL btree_gist Exclusion Constraint (Double-Booking Prevention) should allow re-booking a slot if previous appointment was cancelled or no_show
- Database Integrity & Constraints Append-Only Audit Log Trigger should reject UPDATE on audit_log with trigger exception
- Database Integrity & Constraints Append-Only Audit Log Trigger should reject DELETE on audit_log with trigger exception
**openapi-coverage.test.js**
- OpenAPI spec matches the real API every registered route is documented
- OpenAPI spec matches the real API nothing is documented that does not exist
- OpenAPI spec matches the real API docs/openapi.yaml is in sync with the JSON source (run: npm run docs:openapi)
- OpenAPI spec matches the real API every protected operation declares auth and the shared error responses
- OpenAPI spec matches the real API every state-changing booking/billing POST requires the Idempotency-Key header in the spec
**phase2-fixes.test.js**
- Phase 2 Round 2 Fixes & Verification Suite Fix 1: Slot containment with multiple schedule blocks on one weekday selects containing block among multiple blocks and rejects break intervals
- Phase 2 Round 2 Fixes & Verification Suite Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries Clinician CANNOT start consultation directly from scheduled (409 INVALID_TRANSITION)
- Phase 2 Round 2 Fixes & Verification Suite Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries Clinician starts consultation from checked_in and completes it
- Phase 2 Round 2 Fixes & Verification Suite Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries Clinician CANNOT cancel an appointment (returns 403 FORBIDDEN and logs audit)
- Phase 2 Round 2 Fixes & Verification Suite Fix 2: Strict AGENTS.md State Machine & Lifecycle Boundaries Front Desk CANNOT start or complete consultation (returns 403 FORBIDDEN)
- Phase 2 Round 2 Fixes & Verification Suite Fix 3: Early Authorization & 403 Audit Logging returns 403 (NOT 409) when Clinician 2 attempts invalid transition on Clinician 1 appointment
- Phase 2 Round 2 Fixes & Verification Suite Fix 3: Early Authorization & 403 Audit Logging Clinician accessing another doctor appointment via GET /appointments/:id returns 403
- Phase 2 Round 2 Fixes & Verification Suite Fix 4: Concurrent Check-In vs Cancel (Optimistic State Locking) exactly one transition succeeds (200) and the other returns 409 INVALID_TRANSITION
- Phase 2 Round 2 Fixes & Verification Suite Fix 5: Transactional Atomicity (Mutation + Audit in One Transaction) rolls back appointment creation if audit insertion fails
- Phase 2 Round 2 Fixes & Verification Suite Fix 5: Transactional Atomicity (Mutation + Audit in One Transaction) SERVICE-LEVEL atomicity: POST /appointments leaves NO row when the real audit write fails, and the key can be retried
- Phase 2 Round 2 Fixes & Verification Suite Fix 6: Advanced Idempotency Semantics & Scoping canonicalJsonStringify produces identical hash regardless of key order
- Phase 2 Round 2 Fixes & Verification Suite Fix 6: Advanced Idempotency Semantics & Scoping reapStaleProcessingKeys successfully cleans up orphaned processing rows > 60s
- Phase 2 Round 2 Fixes & Verification Suite Fix 6: Advanced Idempotency Semantics & Scoping scopes idempotency keys by user: User 1 and User 2 can reuse the same key independently
- Phase 2 Round 2 Fixes & Verification Suite Fix 7: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions Scenario 1: 20 simultaneous bookings for identical slot -> exactly 1 succeeds (201), 19 get 409 SLOT_TAKEN (fast < 2s)
- Phase 2 Round 2 Fixes & Verification Suite Fix 7: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions Scenario 2: 20 simultaneous bookings for same patient at same time -> exactly 1 succeeds, 19 get 409 PATIENT_DOUBLE_BOOKED (fast < 2s)
- Phase 2 Round 2 Fixes & Verification Suite Fix 7: Advisory Locking, Deadlock Retry, Pool max 20 & Explicit Error Code Assertions Scenario 3: 20 simultaneous reschedule requests with expectedVersion: 1 -> exactly 1 succeeds, 19 get 409 STALE_VERSION
- Phase 2 Round 2 Fixes & Verification Suite Fix 8: Advanced Vitest Concurrency Test Cases (a) 10 concurrent POSTs with SAME Idempotency-Key -> exactly 1 row created, responses return same appointment or IDEMPOTENCY_IN_PROGRESS
- Phase 2 Round 2 Fixes & Verification Suite Fix 8: Advanced Vitest Concurrency Test Cases (b) 5 concurrent reschedules of different appointments into ONE target slot -> exactly one 200, four SLOT_TAKEN
- Phase 2 Round 2 Fixes & Verification Suite Fix 9: Reschedule Rollback Proof & Input Validations Reschedule rollback proof: colliding slot reschedule fails with 409 and keeps appointment unmodified
- Phase 2 Round 2 Fixes & Verification Suite Fix 9: Reschedule Rollback Proof & Input Validations Rejects past, misaligned, and outside-schedule booking attempts with 422 VALIDATION_ERROR
- Phase 2 Round 2 Fixes & Verification Suite Fix 10: Audit Logging Verification & Pagination/Search Audit logging: records READ_PATIENT_RECORD, UPDATE_PATIENT, and 403 clinician access denial
- Phase 2 Round 2 Fixes & Verification Suite Fix 10: Audit Logging Verification & Pagination/Search Pagination and search work correctly on appointments and patients
- Phase 2 Round 2 Fixes & Verification Suite Fix 11: GET /patients Repo-level Clinician Isolation & Encounter Access Clinician sees only patients assigned to them; other patients omitted from list & 403 on getById
- Phase 2 Round 2 Fixes & Verification Suite Fix 11: GET /patients Repo-level Clinician Isolation & Encounter Access checkClinicianPatientAccess: Clinician can access a patient who has an encounter only (no appointment)
- Phase 2 Round 2 Fixes & Verification Suite Fix 12: Directory Admin Administration & RBAC Enforcement GET /doctors/:id returns doctor details for admin, clinician and front_desk
- Phase 2 Round 2 Fixes & Verification Suite Fix 12: Directory Admin Administration & RBAC Enforcement Admin can PATCH and DELETE department, clinician/front_desk get 403
- Phase 2 Round 2 Fixes & Verification Suite Fix 12: Directory Admin Administration & RBAC Enforcement Admin can PATCH and DELETE doctor & schedule rules with auditing
- Phase 2 Round 2 Fixes & Verification Suite Fix 13: env.js Security Validations parseDurationToSeconds accurately parses duration strings
- Phase 2 Round 2 Fixes & Verification Suite Fix 13: env.js Security Validations validateEnv rejects missing/short JWT_SECRET in development/production
- Phase 2 Round 2 Fixes & Verification Suite Fix 13: env.js Security Validations validateEnv rejects JWT_EXPIRES_IN greater than 8 hours
- Phase 2 Round 2 Fixes & Verification Suite Fix 13: env.js Security Validations validateEnv accepts valid 8h expiry and 32+ character secrets
- Phase 2 Round 2 Fixes & Verification Suite Fix 14: PostgreSQL Sequences & Input Validation generates sequential appointment numbers and MRNs via PostgreSQL sequences
- Phase 2 Round 2 Fixes & Verification Suite Fix 14: PostgreSQL Sequences & Input Validation PUT /patients/:id returns 422 VALIDATION_ERROR when no update fields are given
**phase2.test.js**
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B1: Patient Double-Booking Exclusion Constraint blocks the same patient from holding two overlapping appointments across different doctors
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B2: Slot Computation API GET /api/v1/slots computes available slots aligned to schedule in hospital timezone
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B2: Slot Computation API GET /api/v1/slots rejects date ranges exceeding 14 days with 422 VALIDATION_ERROR
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B3: Appointments API Lifecycle & State Machine books appointment with Idempotency-Key header
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B3: Appointments API Lifecycle & State Machine reschedules appointment and increments version
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B3: Appointments API Lifecycle & State Machine rejects reschedule with stale version (409 STALE_VERSION)
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B3: Appointments API Lifecycle & State Machine validates state machine progression (scheduled -> checked_in -> in_consultation -> completed)
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B3: Appointments API Lifecycle & State Machine rejects invalid state transition (completed -> scheduled returns 409 INVALID_TRANSITION)
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B5: Idempotency Middleware Semantics returns cached response when replaying exact same Idempotency-Key and payload
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B5: Idempotency Middleware Semantics returns 422 IDEMPOTENCY_KEY_REUSED when replaying same key with different body payload
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B6: Directory & Staff Administration Admin: creates staff user and deactivates staff
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency B6: Directory & Staff Administration Admin: creates schedule rule and rejects overlapping schedule rules
- Phase 2 Integration Tests: Appointments, Slots, RBAC & Concurrency Patient Record Updates and Auditing Front Desk: updates patient demographics and writes audit log
**phase3-clinical-billing.test.js**
- Phase 3: encounters, clinical records, billing, reports, audit viewer Encounter lifecycle opens an encounter when the clinician starts the consultation and closes it on completion (with audit)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Encounter lifecycle never creates two encounters for the same appointment
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports clinician writes a note to their own open encounter, and the note TEXT never reaches the audit log
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports rejects an incomplete note with 422 VALIDATION_ERROR
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports another clinician cannot write to this encounter: 403 plus a PERMISSION_DENIED audit entry
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports front_desk and admin cannot write clinical notes (403)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports unknown encounter is 404 and a malformed id is 422 (never a 500)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports saves a prescription with items; audit holds counts only, never medicine names
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports rejects an empty prescription and a non-positive duration with 422
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports diagnostic report metadata: allowed for a treating clinician, 403+audit otherwise, 422 on bad category
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports treating clinician reads the full record (audited); admin, front_desk and an unrelated clinician get 403
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports closed encounters reject further notes with 409 ENCOUNTER_CLOSED
- Phase 3: encounters, clinical records, billing, reports, audit viewer Clinical notes, prescriptions, diagnostic reports encounter list: admin gets metadata only (no clinical content), clinician only their own, front_desk 403
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices computes totals in integer paise on the server and reconciles
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices rejects fractional, negative, empty and impossible amounts with 422
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices requires an Idempotency-Key and replays the same invoice for a repeated key
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices one active invoice per appointment (409 INVOICE_EXISTS); appointment must belong to the patient
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices lists with status filter, search and pagination; money comes back as numbers
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices seeded invoices all reconcile (items + tax - discount = total, status matches payments)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: invoices a malformed invoice id is 422, an unknown one is 404
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments partial then final payment moves unpaid -> partial -> paid; overpaying a settled invoice is blocked
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments rejects overpayment (422 OVERPAYMENT_REJECTED): no payment row, invoice unchanged, attempt audited
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments a declined card is recorded but moves no money; only the last four digits are ever stored
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments rejects unknown card numbers and a card payment without a number (422)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments RACE: 10 concurrent payments of 40% each can never exceed the invoice (exactly 2 succeed)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments RACE: 10 concurrent payments with the SAME Idempotency-Key charge exactly once
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: payments invoice cancellation: needs a reason, blocked once money was taken, frees the appointment for re-invoicing
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: authorization (role x endpoint) clinician is denied every billing endpoint (403) and the denial is audited
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: authorization (role x endpoint) admin is read-only: may list and read, but create/pay/cancel are 403
- Phase 3: encounters, clinical records, billing, reports, audit viewer Billing: authorization (role x endpoint) unauthenticated requests are 401
- Phase 3: encounters, clinical records, billing, reports, audit viewer Admin reports summary numbers equal an independent SQL calculation
- Phase 3: encounters, clinical records, billing, reports, audit viewer Admin reports only admin may read it; bad ranges are 422
- Phase 3: encounters, clinical records, billing, reports, audit viewer Audit log viewer is paginated with a total, filterable by action, actor and date, admin only
- Phase 3: encounters, clinical records, billing, reports, audit viewer Audit log viewer stays append-only: UPDATE and DELETE on audit_log are rejected by the database
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity applies a valid update and stores before/after in one audit entry; empty email clears it
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity rejects malformed values with 422 and changes nothing
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity cannot overwrite fields outside the allowed set (mrn, is_active, id): unknown keys are 422
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity only front_desk may update (admin and clinician are 403); unknown patient is 404; bad id is 422
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity update and audit are atomic: if the audit write fails the patient row is unchanged
- Phase 3: encounters, clinical records, billing, reports, audit viewer Patients: update validation and atomicity concurrent updates serialise on the row lock: every audit entry has a consistent before/after chain
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety deleting a doctor revokes access: the existing session AND new logins stop working
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety PATCH isActive false/true toggles the doctor login in step
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety creating a doctor is atomic: a failing audit write leaves no orphan login account
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety unknown department is 404 and creates no account; duplicate email is 409
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety doctor and staff creation is admin-only (front_desk and clinician get 403)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety staff list never exposes password hashes; an admin cannot deactivate their own account
- Phase 3: encounters, clinical records, billing, reports, audit viewer Directory: access revocation, atomic account creation, staff safety a deactivated staff account cannot sign in, and its audit entry records before/after
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /appointments survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /patients survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /directory/staff survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /billing/invoices survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /audit/logs survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint /clinical/encounters survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)
- Phase 3: encounters, clinical records, billing, reports, audit viewer Pagination input is clamped on every list endpoint slot search clamps too
**rbac.test.js**
- RBAC Matrix & Audit Enforcement Tests Resource: Directory Admin: ALLOWED to create department (write)
- RBAC Matrix & Audit Enforcement Tests Resource: Directory Clinician: DENIED creating department (403 FORBIDDEN and audited)
- RBAC Matrix & Audit Enforcement Tests Resource: Directory Front Desk: DENIED creating department (403 FORBIDDEN and audited)
- RBAC Matrix & Audit Enforcement Tests Resource: Directory All Roles: ALLOWED to read directory departments
- RBAC Matrix & Audit Enforcement Tests Resource: Patients Front Desk: ALLOWED to create patient
- RBAC Matrix & Audit Enforcement Tests Resource: Patients Admin: DENIED creating patient (403 FORBIDDEN - least privilege)
- RBAC Matrix & Audit Enforcement Tests Resource: Patients Clinician: DENIED creating patient demographics (403 FORBIDDEN)
- RBAC Matrix & Audit Enforcement Tests Resource: Patients Front Desk: ALLOWED to read patient list
- RBAC Matrix & Audit Enforcement Tests Resource: Patients Security check: handles special characters and quotes safely in patient search query without SQL injection
- RBAC Matrix & Audit Enforcement Tests Resource: Clinical Notes Clinician (treating patient): ALLOWED to read clinical notes
- RBAC Matrix & Audit Enforcement Tests Resource: Clinical Notes Clinician (NOT treating patient): DENIED access to clinical notes (403 FORBIDDEN and audited)
- RBAC Matrix & Audit Enforcement Tests Resource: Clinical Notes Admin: DENIED reading clinical notes (403 FORBIDDEN - admin can only see metadata)
- RBAC Matrix & Audit Enforcement Tests Resource: Clinical Notes Front Desk: DENIED reading clinical notes (403 FORBIDDEN)
- RBAC Matrix & Audit Enforcement Tests Resource: Billing / Invoices Admin: ALLOWED to read billing invoices
- RBAC Matrix & Audit Enforcement Tests Resource: Billing / Invoices Front Desk: ALLOWED to read billing invoices
- RBAC Matrix & Audit Enforcement Tests Resource: Billing / Invoices Clinician: DENIED reading billing invoices (403 FORBIDDEN and audited)
- RBAC Matrix & Audit Enforcement Tests Resource: Audit Logs Admin: ALLOWED to view system audit logs
- RBAC Matrix & Audit Enforcement Tests Resource: Audit Logs Front Desk: DENIED viewing audit logs (403 FORBIDDEN)
- RBAC Matrix & Audit Enforcement Tests Resource: Audit Logs Clinician: DENIED viewing audit logs (403 FORBIDDEN)
**security-isolation.test.js**
- Security Hardening & Test DB Isolation Checks A2: Test Database Isolation Proof proves tests run against aarogya_hms_test, NOT the development database aarogya_hms
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks enforces JSON body size limit (rejects payload > 100kb with 413)
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks forced internal and database errors return a generic 500: no stack trace, SQL, file paths or error message
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks validates bcrypt hash cost is >= 10
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks the limiter really returns 429 in the standard error format once the limit is exceeded
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks the real login route is actually behind the limiter (rate-limit headers present)
- Security Hardening & Test DB Isolation Checks A3: Security Hardening Checks newly created staff accounts are hashed with bcrypt cost >= 10 and the hash is never returned
**timezone.test.js**
- Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30) converts hospital local 09:00 IST to 03:30:00.000Z UTC
- Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30) converts hospital local 17:00 IST to 11:30:00.000Z UTC
- Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30) correctly maps UTC Date back to hospital local date and time
- Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30) correctly maps hospital local day of week (e.g. 2026-11-10 is Tuesday = 2)
- Timezone Utility (Hospital TZ: Asia/Kolkata = UTC+05:30) verifies HOSPITAL_TZ is set to Asia/Kolkata

</details>


---

## 8. Frontend Web Test Suite (`npm run test:web`, 32 passed)

Executed with Vitest, React Testing Library, and jsdom, driving the real browser application components against the real Express backend API and PostgreSQL test database:

```text
> aarogya-hms@1.0.0 test:web
> npm --workspace=frontend run test

> aarogya-hms-frontend@1.0.0 test
> vitest run

 RUN  v3.2.7 C:/Users/ASUS/Downloads/aarogya-hms/frontend

[Test Setup] Ensuring test database is migrated and seeded...
[Migrate] Database is already up to date. No new migrations.
[Seed] Starting idempotent synthetic data seed...
[Seed] Seeding 60 appointments...
[Seed] Database seed completed successfully!
[Test Setup] Test database ready.
[Frontend tests] real API listening on :54944
 ✓ tests/api.test.js (9 tests) 16ms
 ✓ tests/format.test.js (9 tests) 8ms
 ✓ tests/e2e.test.jsx (14 tests) 1840ms

 Test Files  3 passed (3)
      Tests  32 passed (32)
   Start at  18:42:11
   Duration  3.59s (transform 392ms, setup 662ms, collect 496ms, tests 1.87s, environment 746ms, prepare 240ms)

> aarogya-hms@1.0.0 posttest:web
> node scripts/posttest.cjs

[Frontend test teardown] Backend server stopped cleanly.
[Frontend test teardown] Teardown complete.
```

### Frontend Tests Breakdown
- **`tests/api.test.js`** (9 tests):
  - API client error extraction and validation error handling
  - Automatic `Idempotency-Key` header injection per request attempt
  - Error explanation formatting for UI toast notifications
  - Non-JSON error body fallback (502/504 gateways)
  - 401 unauthenticated redirect handling
  - 403 permission denied formatting
- **`tests/format.test.js`** (9 tests):
  - Integer paise to Indian Rupee currency formatting (`rupees(125000)` -> `₹1,250.00`)
  - User text input parsing to integer paise (`rupeesToPaise("1250.50")` -> `125050`)
  - Fractional paise and non-numeric validation rejection
  - Hospital timezone (`Asia/Kolkata`) date, time, and datetime formatting
  - Local hospital day range ISO boundary generation (`istDayRange`)
  - Patient age calculation from birth date
- **`tests/e2e.test.jsx`** (14 tests):
  - Sign in and access control: demo account login, cookie session, role redirect, demo system notice
  - Wrong credentials handling: inline error alert, no redirect
  - Booking board: choose doctor, hospital day, live open slot, select patient, book visit -> slot dynamically updates to booked
  - Booking board concurrency conflict: rival books slot concurrently -> UI catches 409 `SLOT_TAKEN`, displays conflict alert, marks slot cell as "just taken", disables re-selection, and books nothing
  - Keyboard accessibility: navigate and select slot cell via Tab + Enter/Space keys
  - Billing: create invoice, simulate declined card attempt, complete successful payment, reconcile totals to `paid` status
  - Overpayment prevention: UI rejects payment amount exceeding remaining invoice balance with clear feedback
  - Print receipt: print button and print stylesheet availability on invoice drawer
  - Clinician consultation queue: start visit from queue, record diagnosis note and prescription items, complete consultation, verify encounter records match and admin cannot view clinical note text
  - Administrator overview: query and filter append-only activity log by action type
  - Administrator directory: add staff account via modal, verify created account in list, confirm password hashes are never exposed
  - Empty search state: verify custom SVG illustration renders when patient query yields no results

---

## 9. Frontend Production Build (`npm run build:web`, exit code 0)

```text
> aarogya-hms@1.0.0 build:web
> npm --workspace=frontend run build

> aarogya-hms-frontend@1.0.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 2004 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                                       0.99 kB │ gzip:   0.56 kB
dist/assets/plus-jakarta-sans-vietnamese-400-normal-Cg2kxhWu.woff2    4.10 kB
dist/assets/plus-jakarta-sans-vietnamese-600-normal-Y4VTTRme.woff2    4.20 kB
dist/assets/jetbrains-mono-greek-400-normal-C190GLew.woff2            4.23 kB
dist/assets/plus-jakarta-sans-vietnamese-700-normal-CV6qDkkj.woff2    4.27 kB
dist/assets/plus-jakarta-sans-vietnamese-500-normal-DiU8zqi-.woff2    4.28 kB
dist/assets/jetbrains-mono-greek-500-normal-JpySY46c.woff2            4.28 kB
dist/assets/jetbrains-mono-cyrillic-400-normal-BEIGL1Tu.woff2         5.33 kB
dist/assets/jetbrains-mono-cyrillic-500-normal-DmUKJPL_.woff2         5.36 kB
dist/assets/jetbrains-mono-vietnamese-400-normal-CqNFfHCs.woff        5.37 kB
dist/assets/jetbrains-mono-vietnamese-500-normal-DNRqzVM1.woff        5.48 kB
dist/assets/plus-jakarta-sans-vietnamese-400-normal-B8TCSmUq.woff     5.60 kB
dist/assets/jetbrains-mono-greek-400-normal-B9oWc5Lo.woff             5.66 kB
dist/assets/jetbrains-mono-greek-500-normal-D7SFKleX.woff             5.72 kB
dist/assets/plus-jakarta-sans-vietnamese-600-normal-5YsyKbU1.woff     5.74 kB
dist/assets/plus-jakarta-sans-vietnamese-700-normal-BCh_uG_5.woff     5.78 kB
dist/assets/plus-jakarta-sans-vietnamese-500-normal-CvE5C8T-.woff     5.79 kB
dist/assets/fraunces-vietnamese-400-normal-CvGt0Ybw.woff2             6.21 kB
dist/assets/fraunces-vietnamese-600-normal-BjlAJixd.woff2             6.28 kB
dist/assets/jetbrains-mono-cyrillic-400-normal-ugxPyKxw.woff          6.98 kB
dist/assets/jetbrains-mono-cyrillic-500-normal-DJqRU3vO.woff          7.02 kB
dist/assets/jetbrains-mono-latin-ext-400-normal-Bc8Ftmh3.woff2        7.34 kB
dist/assets/jetbrains-mono-latin-ext-500-normal-Cut-4mMH.woff2        7.53 kB
dist/assets/fraunces-vietnamese-600-normal-DlAl5EAR.woff              7.93 kB
dist/assets/fraunces-vietnamese-400-normal-B65MOf9T.woff              7.98 kB
dist/assets/jetbrains-mono-latin-ext-400-normal-fXTG6kC5.woff        10.13 kB
dist/assets/jetbrains-mono-latin-ext-500-normal-ckzbgY84.woff        10.34 kB
dist/assets/plus-jakarta-sans-latin-ext-400-normal-D127hM_v.woff2    10.59 kB
dist/assets/plus-jakarta-sans-latin-ext-500-normal-9VZagAe1.woff2    10.86 kB
dist/assets/plus-jakarta-sans-latin-ext-600-normal-DQgPU_Cg.woff2    10.90 kB
dist/assets/plus-jakarta-sans-latin-ext-700-normal-BajbvANd.woff2    11.01 kB
dist/assets/plus-jakarta-sans-latin-400-normal-Dhut76fR.woff2        11.82 kB
dist/assets/plus-jakarta-sans-latin-600-normal-DLTa1BUW.woff2        12.19 kB
dist/assets/plus-jakarta-sans-latin-700-normal-CfpNZvy6.woff2        12.24 kB
dist/assets/plus-jakarta-sans-latin-500-normal-Bf-nb4oT.woff2        12.31 kB
dist/assets/plus-jakarta-sans-latin-ext-400-normal-2ppkqaOR.woff     15.31 kB
dist/assets/plus-jakarta-sans-latin-ext-600-normal-B0WRRYJ1.woff     15.61 kB
dist/assets/plus-jakarta-sans-latin-ext-700-normal-8-d-IyIQ.woff     15.62 kB
dist/assets/plus-jakarta-sans-latin-ext-500-normal-CqEEAICU.woff     15.62 kB
dist/assets/plus-jakarta-sans-latin-400-normal-BDKaGhyp.woff         15.73 kB
dist/assets/plus-jakarta-sans-latin-600-normal-BR_Ojra4.woff         16.08 kB
dist/assets/plus-jakarta-sans-latin-500-normal-DYtqi0QS.woff         16.12 kB
dist/assets/plus-jakarta-sans-latin-700-normal-DqEcQeE5.woff         16.14 kB
dist/assets/fraunces-latin-ext-400-normal-D8gbi3Gu.woff2             17.29 kB
dist/assets/fraunces-latin-ext-600-normal-BtzmzP0X.woff2             17.34 kB
dist/assets/fraunces-latin-400-normal-6IfK1voy.woff2                 17.97 kB
dist/assets/fraunces-latin-600-normal-BFCDtZfi.woff2                 18.10 kB
dist/assets/jetbrains-mono-latin-400-normal-V6pRDFza.woff2           21.17 kB
dist/assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2           21.83 kB
dist/assets/fraunces-latin-ext-600-normal-B0Dy4lqi.woff              22.36 kB
dist/assets/fraunces-latin-ext-400-normal-UihxqfOe.woff              22.37 kB
dist/assets/fraunces-latin-400-normal-NUPT2cO8.woff                  22.48 kB
dist/assets/fraunces-latin-600-normal-DL5QCzvS.woff                  22.51 kB
dist/assets/jetbrains-mono-latin-400-normal-6-qcROiO.woff            27.50 kB
dist/assets/jetbrains-mono-latin-500-normal-CJOVTJB7.woff            28.21 kB
dist/assets/index-DPSOTwsn.css                                       71.88 kB │ gzip:  29.74 kB
dist/assets/plus-BaEoYKGh.js                                          0.32 kB │ gzip:   0.25 kB
dist/assets/user-plus-DQGK9_KQ.js                                     0.48 kB │ gzip:   0.33 kB
dist/assets/trash-2-Bt339Rvj.js                                       0.53 kB │ gzip:   0.34 kB
dist/assets/calendar-clock-tM8cjQYT.js                                0.55 kB │ gzip:   0.36 kB
dist/assets/PatientPicker-BrG3amy_.js                                 2.17 kB │ gzip:   0.91 kB
dist/assets/useMutation-ClBYq-b3.js                                   3.17 kB │ gzip:   1.28 kB
dist/assets/Booking-D56VoQCl.js                                       5.36 kB │ gzip:   2.31 kB
dist/assets/SlotBoard-Ch_W-l4n.js                                     5.56 kB │ gzip:   2.47 kB
dist/assets/Queue-CzIjiOQi.js                                         5.56 kB │ gzip:   2.12 kB
dist/assets/Dashboard-ci1d4cim.js                                     6.24 kB │ gzip:   2.17 kB
dist/assets/Activity-C6k6JLew.js                                      6.81 kB │ gzip:   2.40 kB
dist/assets/Patients-DlEvsUY8.js                                      7.34 kB │ gzip:   2.91 kB
dist/assets/useQuery-BWI6P8aO.js                                      9.50 kB │ gzip:   3.38 kB
dist/assets/Appointments-Bo-ru7fq.js                                 11.36 kB │ gzip:   3.84 kB
dist/assets/PatientRecord-BJoRMsGV.js                                11.73 kB │ gzip:   3.91 kB
dist/assets/Directory-Bw56v43T.js                                    16.89 kB │ gzip:   4.61 kB
dist/assets/Billing-C_2CwBDU.js                                      18.27 kB │ gzip:   5.71 kB
dist/assets/index-Ddaxdn-n.js                                       356.63 kB │ gzip: 113.90 kB
✓ built in 6.05s
```
