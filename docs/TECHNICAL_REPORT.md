# Aarogya HMS — Technical Architecture Report

## 1. Problem & Scope
Healthcare management systems require strict data isolation, zero tolerance for appointment race conditions, rigorous auditability, and clear separation of privileges. Aarogya HMS is an enterprise-grade Hospital Management System designed for the Algions AI Labs assessment.

The scope encompasses:
- Core hospital directory, departments, and doctor weekly scheduling.
- Patient demographic intake and medical record management with unique MRNs.
- Appointment scheduling, status machine progression, and collision prevention.
- Clinical encounter records and doctor notes (**strictly clinician-entered only**; zero automated or algorithmic diagnosis).
- Invoicing and billing with integer paise arithmetic and simulated payment processing.
- Strict server-side RBAC and append-only audit logging across all sensitive operations.

> **Non-negotiable constraint**: Synthetic data only. No real patient data exists in any part of this repository.

---

## 2. Architecture
Aarogya HMS is architected as a **layered modular monolith** adhering to strict single-direction dependency flow:
```
Routes  ──>  Controllers  ──>  Services (Business Logic)  ──>  Repositories (Plain SQL)
```
- **Routes**: Define HTTP verbs, mount path prefixes, and bind authentication / authorization middleware.
- **Controllers**: Parse input, invoke Zod validation schemas, call services, and structure HTTP responses.
- **Services**: Enforce domain invariants, trigger audit logging, and coordinate multi-repository transactions.
- **Repositories**: Execute parameterized SQL queries via `pg.Pool`. No ORMs or query builders are used to maintain complete visibility over PostgreSQL execution plans and native features.
- **Central Error Pipeline**: Catches application errors, validation issues, and Postgres exceptions (e.g. `23P01`), outputting standard JSON payloads with correlated `requestId`.

---

## 3. Data Model & Integrity Decisions
The relational schema comprises 18 tables defined in native SQL DDL:
1. **Primary Keys**: UUID v4 across all tables via `gen_random_uuid()` to prevent integer enumeration attacks.
2. **Monetary Precision**: All monetary values (consultation fees, item unit prices, invoice totals, payments) are stored as `BIGINT` representing integer paise (100 paise = 1 INR). JavaScript floating-point arithmetic is avoided entirely.
3. **Database Checks & Constraints**:
   - `chk_invoice_math`: Enforces `total_paise = subtotal_paise + tax_paise - discount_paise`.
   - `chk_item_total`: Enforces `total_paise = quantity * unit_price_paise`.
   - `chk_schedule_time` & `chk_appointment_time`: Enforces `starts_at < ends_at`.
4. **Referential Integrity**: Explicit `ON DELETE RESTRICT` on vital medical entities (patients, doctors, appointments, invoices) preventing accidental cascading deletions of clinical history.

---

## 4. Concurrency & Idempotency
1. **Advisory Transaction Locking**:
   To serialize concurrent bookings and reschedules cleanly without thread starvation or table lock escalation, transactions acquire PostgreSQL transaction-scoped advisory locks in a strict global order:
   ```sql
   SELECT pg_advisory_xact_lock(1, hashtext($doctorId));
   SELECT pg_advisory_xact_lock(2, hashtext($patientId));
   ```
   Deadlock detection code `40P01` is wrapped by `withDeadlockRetry` with randomized exponential backoff (max 3 retries) and never misclassified as `SLOT_TAKEN`.
2. **Double-Booking Elimination**:
   Rather than relying on fragile application-level checks, double-booking is prevented at the storage engine layer using PostgreSQL's `btree_gist` extension:
   ```sql
   CONSTRAINT uq_doctor_slot_no_overlap EXCLUDE USING gist (
       doctor_id WITH =,
       tstzrange(starts_at, ends_at) WITH &&
   ) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'));

   CONSTRAINT uq_patient_slot_no_overlap EXCLUDE USING gist (
       patient_id WITH =,
       tstzrange(starts_at, ends_at) WITH &&
   ) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'));
   ```
   If two booking attempts race for the same doctor or same patient with overlapping times, PostgreSQL immediately aborts the conflicting transaction with SQLSTATE `23P01`. The backend catches `23P01` and returns HTTP `409 SLOT_TAKEN` or `409 PATIENT_DOUBLE_BOOKED`.
3. **Idempotency Architecture**:
   Keys are scoped by `(user_id, method, path, idempotency_key)`. The `idempotency_keys` table stores incoming request canonical SHA-256 hashes, statuses, and payloads. Replaying requests with the same key returns the cached response; modifying payloads under the same key yields `422 IDEMPOTENCY_PAYLOAD_MISMATCH`. Stale in-flight keys are reaped after 60 seconds on a non-blocking interval and on insert conflict.
4. **State Machine & Atomic Status Transitions**:
   Transitions strictly follow `scheduled -> checked_in -> in_consultation -> completed`, with cancellations permitted only from `scheduled` or `checked_in`. Transitions use optimistic version checks (`WHERE id=$1 AND status=$expectedStatus AND version=$expectedVersion`) returning 409 `INVALID_TRANSITION` or `STALE_VERSION`.
5. **Deterministic Sequences**:
   PostgreSQL sequences `seq_patient_mrn` and `seq_appointment_number` generate atomic, monotonically incrementing identifiers (`MRN-2026-XXXXXX` and `APT-2026-XXXXXX`).

---

## 5. Security & RBAC
1. **Server-Side RBAC**:
   Role authorization is enforced on every endpoint through the `requireRole(...)` middleware using the readable policy table in `backend/src/config/rbac.js`.
2. **Clinician Data Isolation**:
   - `GET /patients`: Clinicians are restricted at the repository SQL level to patients with whom they have an existing appointment or encounter (`WHERE id IN (SELECT patient_id FROM appointments WHERE doctor_id = $clinicianDoctorId) OR ...`).
   - `GET /patients/:id`: Clinicians querying a patient outside their clinical relationship receive a 403 `FORBIDDEN` and an audit entry is automatically emitted.
3. **Admin Directory Administration**:
   Admins manage departments, doctors, and schedules with full CRUD/deactivation (`PATCH /departments/:id`, `DELETE /departments/:id`, `PATCH /doctors/:id`, `DELETE /doctors/:id`, `PATCH /schedules/:id`, `DELETE /schedules/:id`). Admins are strictly forbidden from viewing clinical note content (metadata only).
4. **Authentication & Session Hardening**:
   Passwords hashed using `bcrypt` (10 rounds). JWT tokens are issued in secure, `httpOnly`, `SameSite=lax` cookies. `JWT_SECRET` is strictly validated at startup (minimum 32 characters required in dev/prod), and `JWT_EXPIRES_IN` is capped at a maximum of 8 hours.

---

## 6. Audit Design
1. **Append-Only Immutability**:
   The `audit_log` table cannot be modified or truncated. A PostgreSQL trigger function blocks any `UPDATE` or `DELETE` statement:
   ```sql
   CREATE TRIGGER trg_audit_log_append_only
   BEFORE UPDATE OR DELETE ON audit_log
   FOR EACH ROW
   EXECUTE FUNCTION prevent_audit_log_modification();
   ```
   Attempting to update or delete audit records raises exception SQLSTATE `55000`.
2. **Comprehensive Event Coverage**:
   - Every patient record read (`READ_PATIENT_RECORD`, `READ_PATIENT_LIST`).
   - Every clinical note read (`READ_CLINICAL_NOTE`).
   - All logins, logouts, and failed authentication attempts (`LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`).
   - All 403 authorization denials (`PERMISSION_DENIED`) recording actor, requested resource, attempted verb, and IP address.

---

## 7. Testing Strategy
- **Real Database Testing**: No database mocking. Tests execute against an isolated PostgreSQL 16 database (`aarogya_hms_test`).
- **Test Matrix**:
  - `tests/db.test.js`: Direct SQL tests verifying the `btree_gist` exclusion constraint, partial overlaps, adjacent back-to-back slot boundaries, and audit log append-only triggers.
  - `tests/auth.test.js`: Health check, valid login, invalid password, nonexistent email, unauthenticated access, inactive user rejection, and cookie clearing on logout.
  - `tests/rbac.test.js`: Full matrix coverage verifying at least one allowed and one denied operation per role (`admin`, `clinician`, `front_desk`) across resources (`directory`, `patients`, `clinical_notes`, `billing`, `audit_logs`), plus verification of audit log emission on 403 denials.
  - `tests/phase2.test.js`, `tests/phase2-fixes.test.js`: booking rules, slot engine, state machine, optimistic locking, idempotency, advisory-lock concurrency (20 simultaneous bookings, 10 same-key requests, 5 colliding reschedules), transactional audit rollback, access control per role.
  - `tests/phase3-clinical-billing.test.js`: encounter lifecycle, clinical notes/prescriptions/reports and their privacy rules, invoices and payments (including 10 concurrent payments and 10 concurrent same-key payments), reconciliation, doctor access revocation, atomic account creation, pagination clamping, reports (checked against independent SQL), audit viewer.
  - `tests/architecture.test.js`: fails the build if SQL or a database import appears outside repositories, if a secret fallback literal appears in source, or if `console.*` is used instead of the structured logger.
  - `tests/openapi-coverage.test.js`: walks Express's real router and fails if any route is undocumented, any documented route does not exist, or `docs/openapi.yaml` drifts from its JSON source.
- **Proof tests have teeth**: the audit-atomicity and doctor-revocation tests were each run once against deliberately re-broken code and failed, then passed again after restoring it (see `TEST_EVIDENCE.md`).

---

## 8. Billing, Clinical Records & Reporting

### Billing (`/billing`)
- **Money is integer paise end to end.** Request schemas reject fractions and negatives; the database stores `BIGINT`; responses convert to JSON numbers. Totals are computed on the server (`subtotal = sum(quantity x unit price)`, `total = subtotal + tax - discount`) and a discount larger than subtotal plus tax is a 422.
- **Overpayment cannot happen, even concurrently.** Taking a payment locks the invoice row (`SELECT ... FOR UPDATE`), sums successful payments, and rejects with `422 OVERPAYMENT_REJECTED` if the amount exceeds the balance. A test fires 10 concurrent payments of 40 % of an invoice: exactly 2 succeed and the paid total is 80 %.
- **Reconciliation is a first-class output.** `GET /billing/invoices/:id` returns `reconciliation.consistent`, true only when items + tax - discount equals the stored total and the stored status equals the status derived from successful payments. A test checks every seeded invoice.
- **One live invoice per appointment** (partial unique index, cancelled invoices excluded) prevents double billing.
- **Simulated gateway, safe by construction.** A declined card is recorded (`402 PAYMENT_DECLINED`) but moves no money. Only the last four digits are stored; tests assert the full number appears in no table, audit entry or response.
- Invoice creation and payments require an `Idempotency-Key`. Writes are front_desk only; admin is read-only; clinicians get 403 and the denial is audited.

### Clinical records (`/clinical`)
- Starting a consultation opens an **encounter** and completing it closes it, inside the same transaction as the status change (one encounter per appointment is a database `UNIQUE`).
- Notes, prescriptions and diagnostic-report metadata are written by clinicians only, only into their own open encounter (`409 ENCOUNTER_CLOSED` afterwards). The system never generates diagnoses or drug advice.
- **The audit log must not become a side channel.** Admins can read audit entries but must not read clinical content, so clinical audit entries hold ids and counts only. A test writes a unique marker into a note and asserts it appears in no audit row.
- Admin can list encounters as metadata (the query never joins clinical tables). The full record endpoint is clinician-with-relationship only and is itself audited.

### Reports and audit viewer
- `GET /reports/summary` (admin): appointments by status, revenue by method and by day, billed vs outstanding, declined payments and top doctors, over a hospital-local date range (max 366 days). Tests compare every figure with an independent SQL calculation that does its own timezone arithmetic.
- `GET /audit/logs` (admin): paginated with a total, filterable by actor, action, entity and date. The table stays append-only (triggers reject UPDATE and DELETE; tested).

### Access revocation and account integrity
- Deactivating a doctor also disables the linked login, and the session lookup refuses a doctor profile that is inactive, so existing sessions die immediately. (An earlier version only flipped the doctor flag; a removed doctor could keep signing in.)
- Creating a doctor writes the login, the profile and the audit entry in one transaction, so a failure cannot leave a clinician login with no doctor profile.
- An admin cannot deactivate their own account.

### Layering and consistency
- Controllers validate with Zod, services hold rules and transactions, repositories hold all SQL (enforced by `architecture.test.js`). A shared `withTransaction` helper keeps BEGIN/COMMIT/ROLLBACK in one place.
- Every list endpoint clamps `page` and `pageSize` (1-100); garbage input never reaches SQL.
- Seed data is idempotent: a bug where every re-seed duplicated invoice line items (so totals no longer matched their items) was found by the reconciliation test and fixed; migration 007 repairs databases already affected.

---

## 9. Trade-offs & Known Limitations
The authoritative list lives in the README (**Known Limitations & Assumptions**) so it cannot drift. In summary: no web UI yet; payments are a sandbox simulation without refunds; tax and discounts are plain amounts; diagnostic reports are metadata only; no structured vitals; deactivating a doctor does not reassign future appointments; idempotency replays 4xx results too; no password reset or MFA; in-memory rate limiting; single hospital timezone; `ILIKE` search; pool of 20 per process.

---

## 10. AI Tools & Attribution
- Built with Antigravity AI pair programming agent.
- Code conforms to human-explainable, clean ES module patterns with zero hidden dependencies.
- Third-party packages: Express, pg, bcrypt, jsonwebtoken, zod, helmet, cors, express-rate-limit, pino, swagger-ui-express, yaml, vitest, supertest.
