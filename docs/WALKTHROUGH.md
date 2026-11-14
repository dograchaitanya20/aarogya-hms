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

---

## Phase 3 (backend): Billing, Clinical Records, Reports, Access Control

### 5. Module Overview: Billing & Payments
- **What it does**: Front desk creates invoices from line items and takes payments; admin can read. All money is integer paise. Totals are computed on the server and reconciled against payments.
- **Key files**:
  - `backend/src/services/billingService.js`: money math, the payment row lock, overpayment rejection, simulated gateway, reconciliation.
  - `backend/src/repositories/invoiceRepository.js`: all invoice/payment SQL.
  - `backend/db/migrations/006_billing_sequences_and_invoice_uniqueness.sql`: number sequences and one live invoice per appointment.

#### Likely Reviewer Questions & Answers
1. **Q: Two cashiers each take 40% of a bill at the same moment. How do you stop the total exceeding the invoice?**
   - **A**: The payment transaction first locks the invoice row with `SELECT ... FOR UPDATE`, then sums successful payments and compares. Concurrent payments for one invoice therefore run one at a time. A test fires 10 simultaneous 40% payments: exactly 2 succeed, 8 get `422 OVERPAYMENT_REJECTED`, and the paid total is exactly 80%.
2. **Q: Why integer paise and not decimals?**
   - **A**: Floating point cannot represent most decimal amounts exactly. Request validation rejects fractions, the column is `BIGINT`, and the API returns JSON numbers (the `pg` driver returns `BIGINT` as strings, so the service converts and refuses unsafe values).
3. **Q: A card is declined. What happens to the invoice and the card number?**
   - **A**: The attempt is stored as a `declined` payment (visible and audited) but no money moves and the invoice status is unchanged. Only the last four digits are ever stored; a test asserts the full number appears in no table, audit entry or response.

### 6. Module Overview: Encounters & Clinical Records
- **What it does**: Starting a consultation opens an encounter; clinicians add notes, prescriptions and diagnostic-report metadata to their own open encounter. Completing the consultation closes it.
- **Key files**:
  - `backend/src/services/clinicalService.js`: ownership checks, audit rules.
  - `backend/src/services/appointmentService.js`: encounter open/close inside the status-change transaction.
  - `backend/src/repositories/clinicalRepository.js`.

#### Likely Reviewer Questions & Answers
1. **Q: Admins can read the audit log. Could they read clinical notes through it?**
   - **A**: No. Clinical audit entries hold ids and counts only, never text. A test writes a unique marker into a note and asserts it appears in no audit row. Admin can list encounters as metadata only; the query never joins the clinical tables.
2. **Q: Who may read a patient's full clinical record?**
   - **A**: Only a clinician with an appointment or encounter with that patient (the same rule in the list filter and the single-read check). Admin, front desk and unrelated clinicians get 403, and the denial is audited. Each permitted read is itself audited.
3. **Q: What stops a clinician editing a finished consultation?**
   - **A**: Notes and prescriptions are only accepted while the encounter is `in_progress`; afterwards the API returns `409 ENCOUNTER_CLOSED`. Writing into another doctor's encounter is `403`.

### 7. Module Overview: Directory, Access Revocation & Staff
- **What it does**: Admin manages departments, doctors, schedules and staff accounts.
- **Key files**:
  - `backend/src/services/directoryService.js`, `backend/src/repositories/userRepository.js`.

#### Likely Reviewer Questions & Answers
1. **Q: An admin removes a doctor. Can that doctor still log in?**
   - **A**: No. Removal disables the linked login in the same transaction, and the session lookup also refuses an inactive doctor profile, so an already-issued cookie stops working immediately. This was a real hole in an earlier version; the test that guards it was verified to fail when the fix is removed.
2. **Q: What if creating a doctor fails halfway?**
   - **A**: The login account, doctor profile and audit entry are written in one transaction, so there is never a clinician login without a doctor profile. A test forces the audit write to fail and asserts no account remains.
3. **Q: Can an admin lock themselves out?**
   - **A**: No. Deactivating your own account returns `409 CANNOT_DEACTIVATE_SELF`.

### 8. Module Overview: Reports, Audit Viewer & Engineering Guards
- **What it does**: Admin summary (appointments, revenue, outstanding, top doctors) and a paginated, filterable audit log. Automated guards keep the code structure honest.
- **Key files**:
  - `backend/src/services/reportService.js`, `backend/src/repositories/auditRepository.js`.
  - `backend/tests/architecture.test.js`, `backend/tests/openapi-coverage.test.js`.

#### Likely Reviewer Questions & Answers
1. **Q: How do you know the report numbers are right?**
   - **A**: The test recomputes revenue, declined payments, outstanding balance and appointment counts with independent SQL that does its own hospital-timezone date arithmetic, and requires exact equality.
2. **Q: How do you keep the API docs from drifting?**
   - **A**: A test walks Express's real router and fails if a route is undocumented, a documented route does not exist, or `docs/openapi.yaml` differs from the JSON source.
3. **Q: How is the controller -> service -> repository layering enforced?**
   - **A**: `architecture.test.js` fails the build if SQL or a database import appears in routes, controllers, services or middleware, if a secret fallback literal appears in source, or if `console.*` is used instead of the structured logger.



---

## Phase 4: Frontend Web Application & User Experience

### 9. Module Overview: Modern React Interface, Design System & Accessibility
- **What it does**: Provides a calm, editorial-clinical web interface for Front Desk, Clinicians, and Administrators built with React 18, Vite, Tailwind CSS, Framer Motion, and TanStack Query. Features live slot boards, keyboard accessibility, print receipt stylesheets, and status overview strips.
- **Key files**:
  - `frontend/src/App.jsx`: Route architecture with `RequireAuth` and `RequireRole` route guards.
  - `frontend/src/lib/api.js`: Fetch client handling `httpOnly` cookie authentication, automatic `Idempotency-Key` generation, and standardized error parsing.
  - `frontend/src/components/SlotBoard.jsx`: Interactive time rail displaying open, booked, and conflicting slots with keyboard support and accessibility tags.
  - `frontend/src/pages/Billing.jsx`: Invoice generation, simulated card terminal, and print receipt drawer.
  - `frontend/src/pages/Appointments.jsx`: Appointments table with live "Today at a glance" status count strip.
  - `frontend/src/components/Illustrations.jsx`: Bespoke, handcrafted inline SVG illustrations for empty search and list states.

#### Likely Reviewer Questions & Answers
1. **Q: Why are UI role guards (`RequireRole`) not considered security?**
   - **A**: UI role guards are strictly a UX convenience to prevent user confusion, not a security boundary. Any user with browser developer tools or a tool like `curl` can inspect client JavaScript, manipulate state, or bypass frontend routing entirely. True security and authorization must be enforced server-side on every protected API route (`requireRole(...)` middleware). In Aarogya HMS, every API request verifies the signed JWT from the `httpOnly` cookie against the database, rejects unauthorized attempts with `403 FORBIDDEN`, and emits an immutable record in the append-only `audit_log`.
2. **Q: How does the UI handle a double-booking race condition when two staff members pick the same slot?**
   - **A**: If two users attempt to book the same slot at the same time, both requests reach the backend where PostgreSQL's `btree_gist` exclusion constraint atomically accepts one and aborts the other with SQLSTATE `23P01` (mapped to HTTP `409 SLOT_TAKEN`). When the losing client receives `409 SLOT_TAKEN`:
     - The UI catches the error code without crashing.
     - Framer Motion animates a horizontal shake on the contested slot cell.
     - The cell is highlighted with a coral warning ring and marked as "just taken".
     - The slot button is immediately disabled (`disabled={isConflict}`) to prevent further attempts.
     - TanStack Query automatically triggers a background refetch of open slots for that doctor and day, ensuring the board reflects real-time hospital capacity.
3. **Q: Why do the frontend automated tests drive the real Express API and PostgreSQL database rather than mocking `fetch` or MSW?**
   - **A**: Mocking network requests (`fetch` mocks or Mock Service Worker) frequently masks critical bugs: subtle HTTP status code mismatches, Zod validation serialization discrepancies, database transaction rollbacks, unique constraint violations, cookie header behaviors, and query race conditions. By spinning up a real Express server on an ephemeral port against an isolated PostgreSQL test database (`aarogya_hms_test`), the 32 frontend tests verify that the real frontend code and real backend database constraints work together seamlessly in end-to-end reality.
