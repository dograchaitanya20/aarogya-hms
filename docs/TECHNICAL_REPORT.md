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
1. **Double-Booking Elimination**:
   Rather than relying on fragile application-level `SELECT ... FOR UPDATE` locks that fail across distributed instances, double-booking is prevented at the storage engine layer using PostgreSQL's `btree_gist` extension:
   ```sql
   CONSTRAINT uq_doctor_slot_no_overlap EXCLUDE USING gist (
       doctor_id WITH =,
       tstzrange(starts_at, ends_at) WITH &&
   ) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'))
   ```
   If two booking attempts race for the same doctor and overlapping time range, PostgreSQL immediately aborts the conflicting transaction with SQLSTATE `23P01`. The backend catches `23P01` and returns HTTP `409 SLOT_TAKEN`.
2. **Idempotency Architecture**:
   The `idempotency_keys` table stores incoming request hashes, paths, response statuses, and payloads. Replaying requests with the same key returns the cached response; modifying payloads under the same key yields `422 UNPROCESSABLE_ENTITY`.

---

## 5. Security & RBAC
1. **Server-Side RBAC**:
   Role authorization is enforced on every endpoint through the `requireRole(...)` middleware using the readable policy table in `backend/src/config/rbac.js`.
2. **Clinician Data Isolation**:
   Clinicians are restricted to their own schedule, appointments, and patients. Access to clinical notes for a patient requires an active or past clinical relationship, validated via `requireClinicianPatientAccess` querying appointment history.
3. **Admin Segregation**:
   Admins manage hospital directory, staff, schedules, and audit trails. Admins are strictly forbidden from viewing clinical note content (metadata only).
4. **Authentication**:
   Passwords hashed using `bcrypt` (10 rounds). JWT tokens are issued in secure, `httpOnly`, `SameSite=lax` cookies, mitigating XSS token harvesting.

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

---

## 8. Trade-offs & Known Limitations
1. **Single Hospital Campus Timezone**: The system assumes a single primary hospital operating under `Asia/Kolkata` (IST, UTC+05:30). All schedule logic and slots are processed in local hospital time and converted to UTC `TIMESTAMPTZ` for storage.
2. **In-Memory Rate Limiting**: The Express rate limiters (`apiLimiter`, `loginLimiter`) operate in Node process memory. In a multi-replica clustered production deployment, a Redis-backed store (`rate-limit-redis`) would be required to share sliding windows across pods.
3. **Connection Pooling Scale**: Native `pg.Pool` is capped at 20 connections per instance. Production deployments supporting thousands of concurrent clinicians would require an external connection pooler such as PgBouncer.
4. **Binary Asset Storage**: Diagnostic report records capture metadata, categories, ordering doctor, and test dates. Document binaries (e.g. large radiology DICOMs or PDFs) are intentionally kept out of PostgreSQL; an S3/MinIO presigned URL integration would be needed for raw binary streaming.
5. **Simulated Payment Gateway**: The billing system models integer paise ledger reconciliation and rejects overpayment. Payment gateway processing is simulated for sandbox testing; real external webhooks (e.g. Razorpay/Stripe) require webhook signature verification endpoints.
6. **No Algorithmic Clinical Decision Support**: Per non-negotiable requirements, the system strictly disallows automated diagnosis or drug-drug interaction warnings; prescription accuracy relies entirely on treating clinician judgment.

---

## 9. AI Tools & Attribution
- Built with Antigravity AI pair programming agent.
- Code conforms to human-explainable, clean ES module patterns with zero hidden dependencies.
- Third-party packages: Express, pg, bcrypt, jsonwebtoken, zod, helmet, cors, express-rate-limit, pino, swagger-ui-express, yaml, vitest, supertest.
