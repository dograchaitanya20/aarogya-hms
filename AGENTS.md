# Aarogya HMS — Hospital Management System
Context: Shortlisting assessment for Algions AI Labs (Full-Stack Web Development role). A reviewer must be able to open the repo, run it, and verify business rules. The candidate will face a 15-minute technical walkthrough and a 10-minute live change/debug task, so the code must be SIMPLE, CONSISTENT and EXPLAINABLE. Prefer boring, readable code over clever code.

## Grading Rubric
- 30 Core workflows & business-rule correctness
- 20 Architecture/data model/APIs
- 15 Security, authorization, data integrity
- 15 Testing & reliability
- 10 UI/UX & responsiveness
- 10 Documentation & demo

## Non-negotiables
- SYNTHETIC DATA ONLY. No real patient data anywhere. Show a "Demo system — synthetic data only" notice in the UI footer.
- No secrets in git. Only `.env.example`. No paid services.
- Server-side RBAC on every protected route. Never rely on hiding UI.
- NO automated diagnosis or clinical decision support. Clinician-entered notes only.
- Money is stored as integer paise (BIGINT). Never floats.
- Modular monolith: routes → controllers → services (business logic) → repositories (SQL). No SQL in routes/controllers.
- Never fake a feature. If something is unfinished, say so in README "Known limitations".

## Stack
- Backend: Node 20, Express (ES modules), `pg` (plain SQL, no ORM), Zod, bcrypt, jsonwebtoken (httpOnly cookie), helmet, cors, express-rate-limit, pino logging, swagger-ui-express + OpenAPI 3 spec.
- DB: PostgreSQL 16 with SQL migration files in `/backend/db/migrations` (own tiny migration runner), idempotent seed script.
- Frontend: React + Vite + Tailwind + Framer Motion + React Router + TanStack Query + Recharts + lucide-react. Fonts via @fontsource (no external CDN).
- Tests: Vitest + Supertest against a REAL test database (no DB mocking).
- Repo: `/backend`, `/frontend`, `/docs`, `docker-compose.yml`, `README.md`, `CREDITS.md`.

## Domain Rules
- Roles: `admin`, `clinician`, `front_desk`.
- Appointment status machine: `scheduled` → `checked_in` → `in_consultation` → `completed`; `scheduled`|`checked_in` → `cancelled`; `scheduled` → `no_show`. Any other transition returns 409 `INVALID_TRANSITION`.
- Double-booking: Enforced by a PostgreSQL EXCLUSION constraint (`btree_gist`) on:
  `(doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status IN ('scheduled','checked_in','in_consultation','completed')`.
  Catch the violation (SQLSTATE `23P01`) and return 409 `SLOT_TAKEN`. Reschedule = single transaction. Slots only within the doctor's schedule, in the future, aligned to `slot_minutes`.
- Idempotency: `POST /appointments` and `POST /payments` accept an `Idempotency-Key` header; replaying the same key + same body returns the original response; same key + different body → 422.
- Billing: `invoice_items(qty, unit_price_paise)`, invoice totals computed from items (subtotal, tax, discount, total) and verified by a reconcile check: `total == sum(items) + tax - discount` AND `sum(successful payments)` determines status (`unpaid` | `partial` | `paid` | `overpaid-rejected`). Payments are SIMULATED (sandbox gateway with test card numbers; declines supported). Overpayment is rejected.
- Audit: Append-only `audit_log` (DB trigger blocks UPDATE/DELETE). Log: every READ of a patient record or clinical note, every create/update/cancel of sensitive entities, logins/failed logins, permission denials. Fields: `ts`, `actor_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `ip_address`, `request_id`.

## RBAC Matrix (Least Privilege)
- `front_desk`: patient demographics (CRUD), appointments (book/reschedule/cancel/check-in), invoices & payments. NO clinical notes, prescriptions, diagnostic reports.
- `clinician`: own schedule, own appointments, patients they have an appointment/encounter with, clinical notes/prescriptions/reports for THOSE patients only. Cannot edit billing or staff.
- `admin`: directory (doctors, departments, staff, schedules), reports, audit log viewer. Can see encounter METADATA but NOT clinical note content.
- Every denial returns 403 `FORBIDDEN` and writes an audit entry.

## API Conventions
- Base: `/api/v1`
- Success: JSON.
- Errors format:
  ```json
  {
    "error": {
      "code": "SLOT_TAKEN",
      "message": "...",
      "details": {},
      "requestId": "..."
    }
  }
  ```
- Validation failure → 422 `VALIDATION_ERROR` with field details.
- Lists are paginated: `?page=&pageSize=&q=&sort=` returning `{ data, page, pageSize, total }`.
- Every endpoint documented in OpenAPI at `/api/docs`.

## Design System (for Frontend phases)
- Aesthetic: Calm, premium, editorial-clinical — NOT generic blue hospital template.
- Tokens: paper bg `#F7F5F0`, ink `#0F1F1C`, primary deep teal `#0E5C5A`, accent coral `#F26B50`, mint `#DDEFE9`, plus success/warning/danger; full dark mode.
- Type: Fraunces (headings), Plus Jakarta Sans (UI), JetBrains Mono (IDs, money).
- Motion (Framer Motion): Page transitions, staggered list reveals, animated number counters, spring slot selection, skeleton shimmer, toast animations. Respect `prefers-reduced-motion`.
- Imagery: Local royalty-free photos in `/frontend/public/images` + custom SVG illustrations; NO hotlinking; credit every photo in `CREDITS.md`. Doctor avatars are illustrated/initials (synthetic people).
- Every screen needs loading, empty, success, and error states. WCAG AA contrast, keyboard navigable, visible focus, labelled forms, responsive 360px → desktop.
