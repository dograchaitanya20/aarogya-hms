# Aarogya HMS — Technical Architecture Walkthrough

## Phase 1: Backend Foundation, Data Model, RBAC, and Audit Core

### 1. Module Overview: Backend Scaffolding & API Core
- **What it does**: Provides an ES module Express backend running on Node 20 with standard error structures, request-id propagation, structured Pino logging, Helmet security headers, CORS configuration, rate limiting, and OpenAPI 3 documentation.
- **Key files**:
  - `backend/src/app.js`: Master Express configuration with middleware pipeline.
  - `backend/src/server.js`: Server lifecycle, database pre-flight connection check, and graceful shutdown.
  - `backend/src/errors/AppError.js`: Domain error hierarchy translating to standardized JSON responses.
  - `backend/src/middleware/errorHandler.js`: Central error handler mapping Zod errors, Postgres exclusion constraint (`23P01`), and custom errors to the standard format.
  - `backend/src/middleware/requestId.js`: Generates / propagates `X-Request-Id` UUID across logs and responses.
- **Why it was designed this way**:
  - Predictable error structure `{ error: { code, message, details, requestId } }` ensures frontend error handling is completely uniform.
  - Request ID correlation ties client failures directly to Pino logs and audit log events.

#### Likely Reviewer Questions & Answers
1. **Q: Why avoid an ORM (Prisma/TypeORM/Drizzle) in favor of raw `pg`?**
   - **A**: Reviewer walkthrough explainability and data integrity. ORMs often obscure advanced PostgreSQL features like `EXCLUDE USING gist`, range types (`tstzrange`), and transactional triggers. Plain SQL in dedicated repositories makes queries inspectable, testable, and prevents N+1 query surprises.
2. **Q: How does the system handle high-precision monetary amounts?**
   - **A**: Money is stored exclusively as `BIGINT` representing integer paise (1 INR = 100 paise). `pg` type parser for OID 20 is configured to prevent IEEE-754 double precision rounding errors common in JavaScript.
3. **Q: What happens if an unhandled exception occurs in a controller or service?**
   - **A**: The central error handler catches it, logs full stack trace with the request ID via Pino, hides internal implementation details in production, and emits a standard `500 INTERNAL_ERROR` JSON payload with the corresponding `requestId`.

---

### 2. Module Overview: PostgreSQL Migrations & Domain Data Model
- **What it does**: Houses the complete hospital relational model (18 tables) with foreign keys, checks, indexes, and an in-house transaction-safe migration runner (`schema_migrations`).
- **Key files**:
  - `backend/db/migrate.js`: Zero-dependency SQL migration runner executing files in transactional batches.
  - `backend/db/migrations/001_initial_schema.sql`: Full DDL defining users, departments, doctors, schedules, appointments, encounters, clinical notes, prescriptions, reports, invoices, payments, and audit tables.
  - `backend/db/seed.js`: Idempotent synthetic data generator populating 8 departments, 16 doctors with weekly schedules, 40 patients, 60 appointments, encounters, notes, and invoices.
- **Why it was designed this way**:
  - The double-booking prevention uses PostgreSQL's native `btree_gist` exclusion constraint:
    `EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status IN ('scheduled', 'checked_in', 'in_consultation', 'completed')`
    This provides an absolute mathematical guarantee against double-booking even under concurrent race conditions.

#### Likely Reviewer Questions & Answers
1. **Q: Why use an EXCLUSION constraint instead of an application-level `SELECT ... FOR UPDATE`?**
   - **A**: Application-level checks rely on developers remembering locks on every code path (booking, rescheduling, bulk intake). If two requests hit different cluster nodes or threads at the same millisecond, application checks can race. The GiST exclusion constraint enforces the invariant at the storage engine level.
2. **Q: How is seed idempotency guaranteed?**
   - **A**: All seed operations use deterministic natural keys (e.g., `email`, `code`, `mrn`, `appointment_number`, `invoice_number`) with `ON CONFLICT DO UPDATE` or `ON CONFLICT DO NOTHING`.
3. **Q: Why are clinical notes kept strictly separate from diagnostic reports?**
   - **A**: Least privilege and clinical safety. The non-negotiable rule specifies no automated diagnosis. Clinical notes represent subjective/objective clinician documentation and diagnoses entered by clinicians only, whereas diagnostic reports contain imaging/lab metadata.

---

### 3. Module Overview: Authentication, RBAC Matrix, and Audit Logging
- **What it does**: Implements session authentication via bcrypt and JWT in `httpOnly` `SameSite=lax` cookies, a centralized RBAC policy table, clinician-to-patient ownership checks, and an append-only audit log.
- **Key files**:
  - `backend/src/config/rbac.js`: Single readable source of truth defining permissions for `admin`, `clinician`, and `front_desk`.
  - `backend/src/middleware/rbac.js`: Middleware enforcing role requirements and patient relationship checks.
  - `backend/src/services/auditService.js`: Service logging logins, failures, patient record reads, clinical note reads, and 403 permission denials.
  - `backend/src/repositories/auditRepository.js`: Database queries for `audit_log`.
- **Why it was designed this way**:
  - RBAC is enforced strictly server-side.
  - Denials return 403 `FORBIDDEN` and immediately write an audit entry with actor, resource, action, IP, and request ID.
  - The `audit_log` table is protected by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger that raises an exception (`55000`), guaranteeing append-only immutability.

#### Likely Reviewer Questions & Answers
1. **Q: Why use `httpOnly` cookies over storing JWTs in localStorage?**
   - **A**: `httpOnly` cookies cannot be accessed by browser JavaScript, completely mitigating client-side token theft via Cross-Site Scripting (XSS).
2. **Q: How does the clinician-patient relationship authorization work?**
   - **A**: A clinician cannot view notes or patient details for arbitrary patients in the hospital. The `requireClinicianPatientAccess` helper verifies in SQL that the clinician has an active or past appointment/encounter with that specific patient. If not, access is denied (403) and audited.
3. **Q: Can a rogue administrator or compromised backend delete audit records?**
   - **A**: No. The database trigger `trg_audit_log_append_only` aborts any `UPDATE` or `DELETE` statement at the database level, preventing tampering even from direct database SQL queries without superuser trigger alterations.
