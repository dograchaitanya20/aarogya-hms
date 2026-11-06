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

#### Likely Reviewer Questions & Answers
1. **Q: Why avoid an ORM (Prisma/TypeORM/Drizzle) in favor of raw `pg`?**
   - **A**: Reviewer walkthrough explainability and data integrity. ORMs often obscure advanced PostgreSQL features like `EXCLUDE USING gist`, range types (`tstzrange`), and transactional triggers. Plain SQL in dedicated repositories makes queries inspectable, testable, and prevents N+1 query surprises.
2. **Q: How does the system handle high-precision monetary amounts?**
   - **A**: Money is stored exclusively as `BIGINT` representing integer paise (1 INR = 100 paise). `pg` type parser for OID 20 is configured to prevent IEEE-754 double precision rounding errors common in JavaScript.
3. **Q: What happens if an unhandled exception occurs in a controller or service?**
   - **A**: The central error handler catches it, logs full stack trace with the request ID via Pino, hides internal implementation details in production, and emits a standard `500 INTERNAL_ERROR` JSON payload with the corresponding `requestId`.

---

## Phase 2: Appointments, Schedules, Slots & Directory Operations

### 2. Module Overview: PostgreSQL Concurrency & Exclusion Constraints
- **What it does**: Eliminates doctor double-booking and patient overlapping bookings using dual PostgreSQL `btree_gist` exclusion constraints.
- **Key files**:
  - `backend/db/migrations/001_initial_schema.sql`: Added doctor exclusion constraint `uq_doctor_slot_no_overlap`.
  - `backend/db/migrations/002_patient_exclusion_and_idempotency.sql`: Added patient exclusion constraint `uq_patient_slot_no_overlap` and optimistic locking `version` column.
  - `backend/scripts/demo-race.js`: Live automated verification running 20 concurrent HTTP bookings, 10 shared-key requests, and 5 concurrent reschedules.

#### Likely Reviewer Questions & Answers
1. **Q: Why use an EXCLUSION constraint instead of SELECT-then-INSERT?**
   - **A**: In concurrent environments, a `SELECT-then-INSERT` pattern suffers from a classic Time-of-Check to Time-of-Use (TOCTOU) race condition. Even with transaction isolation levels like `READ COMMITTED`, two concurrent transactions can simultaneously execute the check query, find zero rows, and both proceed to insert, causing a double-booking. An `EXCLUDE USING gist` constraint guarantees atomic enforcement at the storage engine index layer without relying on explicit developer locks on every query path.
2. **Q: Why does the constraint predicate exclude cancelled and no-show appointments?**
   - **A**: A cancelled or no-show slot is liberated hospital capacity. Excluding `cancelled` and `no_show` from the index predicate allows another patient to legitimately book that exact same doctor and timeframe without manual index re-indexing.
3. **Q: How does optimistic locking protect appointment reschedules?**
   - **A**: Each appointment record carries a `version` counter. A reschedule request requires `expectedVersion`. If another staff member has modified or rescheduled the appointment in the interim, the version will not match, raising `409 STALE_VERSION` and preventing stale overwrite.

---

### 3. Module Overview: Hospital Timezone & Slot Generation Engine
- **What it does**: Computes live, unbooked slots aligned to doctor working hours in `Asia/Kolkata` (IST, UTC+05:30) and stores them as UTC `TIMESTAMPTZ`.
- **Key files**:
  - `backend/src/utils/timezone.js`: Timezone conversion engine handling IST &harr; UTC bidirectional transformations without Daylight Saving Time drift.
  - `backend/src/services/slotService.js`: Scans doctor working schedules, segments slots by `slot_duration_minutes`, filters past timestamps, and excludes active appointments.
  - `backend/src/controllers/slotController.js`: Serves `GET /api/v1/slots` and `GET /api/v1/doctors/:id/slots`.

#### Likely Reviewer Questions & Answers
1. **Q: Why store timestamps as UTC `TIMESTAMPTZ` if the hospital operates in IST?**
   - **A**: PostgreSQL stores all `TIMESTAMPTZ` internally as UTC (offset 0). Storing canonical UTC eliminates cross-system ambiguity, makes automated cron jobs predictable, and enables seamless integration with external APIs while allowing all client presentation to project into `Asia/Kolkata`.
2. **Q: How are slots validated against doctor schedules during booking?**
   - **A**: The booking service validates three invariants: (1) slot start is in the future, (2) slot duration matches the doctor's configured `slot_duration_minutes`, and (3) slot start and end fall completely within the doctor's weekly working hours and align with the slot grid.
3. **Q: How does the slot engine handle date ranges?**
   - **A**: Date range searches are strictly constrained to a maximum of 14 days. Requests exceeding 14 days return `422 VALIDATION_ERROR` to protect the database against excessive computational load.

---

### 4. Module Overview: Idempotency Pipeline
- **What it does**: Guarantees zero duplicate appointment bookings or payments on network retries using the `Idempotency-Key` HTTP header.
- **Key files**:
  - `backend/src/middleware/idempotency.js`: Idempotency interceptor using `idempotency_keys` table.
  - `backend/db/migrations/002_patient_exclusion_and_idempotency.sql`: Added `status` column (`processing` | `completed`).

#### Likely Reviewer Questions & Answers
1. **Q: What happens if two identical requests arrive with the same Idempotency-Key at the exact same millisecond?**
   - **A**: The middleware issues an `INSERT ... ON CONFLICT DO NOTHING RETURNING id` with status `processing`. Exactly one request receives the generated ID and becomes the primary worker; the concurrent request detects `status = 'processing'` and receives `409 IDEMPOTENCY_IN_PROGRESS`.
2. **Q: What happens if a client sends the same Idempotency-Key with a different request payload?**
   - **A**: The middleware hashes the request body with SHA-256. If a matching key exists with a different hash, it returns `422 IDEMPOTENCY_KEY_REUSED` to prevent payload hijacking.
3. **Q: Does an uncaught 500 error permanently lock the idempotency key?**
   - **A**: No. If a server crash or 500 internal error occurs during execution, the middleware deletes the temporary processing record so the client can safely retry once the underlying issue is resolved.
