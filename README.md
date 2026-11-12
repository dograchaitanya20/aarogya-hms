# Aarogya HMS — Hospital Management System

[![CI](https://github.com/dograchaitanya20/aarogya-hms/actions/workflows/ci.yml/badge.svg)](https://github.com/dograchaitanya20/aarogya-hms/actions/workflows/ci.yml)
![Node 20](https://img.shields.io/badge/node-20.x-green.svg)
![PostgreSQL 16](https://img.shields.io/badge/postgresql-16-blue.svg)
![License](https://img.shields.io/badge/license-MIT-purple.svg)

> **DEMO SYSTEM NOTICE**: This repository and database contain strictly **SYNTHETIC DATA ONLY**. No real patient or clinician data is used anywhere in this system.

Aarogya HMS is an enterprise-grade Hospital Management System designed for high clinical explainability, zero race-condition tolerance, server-side role-based access control (RBAC), and append-only auditing.

---

## Reviewer Quick Start

### Option A: Windows PowerShell
```powershell
# 1. Copy Environment Configuration
Copy-Item .env.example .env

# 2. Start PostgreSQL 16 (Provisions dev 'aarogya_hms' and test 'aarogya_hms_test')
docker compose up -d

# 3. Install Monorepo Dependencies
npm install

# 4. Run Migrations & Idempotent Synthetic Seed
npm run migrate
npm run seed

# 5. Run All Real Database Automated Tests (Isolated Test Database)
npm test

# 6. Run the Live Race Condition Double-Booking Demo
npm run demo:race

# 7. Start Development Server
npm run dev
```

### Option B: Windows Command Prompt (`cmd.exe`)
```cmd
:: 1. Copy Environment Configuration
copy .env.example .env

:: 2. Start PostgreSQL 16
docker compose up -d

:: 3. Install Monorepo Dependencies
npm install

:: 4. Run Migrations & Synthetic Seed
npm run migrate
npm run seed

:: 5. Run Real Database Automated Tests
npm test

:: 6. Run the Live Race Condition Double-Booking Demo
npm run demo:race

:: 7. Start Development Server
npm run dev
```

---

## Run the web app

```
npm install
docker compose up -d
npm run migrate
npm run seed
npm run dev          # API on http://localhost:5000  (keep this terminal open)
npm run dev:web      # web app on http://localhost:5173 (second terminal)
```

Open http://localhost:5173 and use a demo account from the sign-in page (all demo accounts use the dummy password in the table below). In development, Vite proxies `/api` to the API, so the httpOnly session cookie works without any CORS setup.

| Screen | Role |
|---|---|
| Appointments, Book a visit (live slot board), Patients, Billing | Front desk |
| Today's queue, patient record (notes, prescriptions, reports) | Clinician |
| Overview (reports), Directory (doctors, hours, departments, staff), Activity log | Administrator |

```
npm run build:web    # production build in frontend/dist
npm run test:web     # 30 tests: unit + UI flows against the real API and database
```

## Reviewer Documentation & Verification Artifacts

| Document | Location | Purpose |
| :--- | :--- | :--- |
| **Interactive API Docs** | [http://localhost:5000/api/docs](http://localhost:5000/api/docs) | Swagger UI for live endpoint exploration |
| **Committed Static OpenAPI Spec** | [`docs/openapi.yaml`](docs/openapi.yaml) | Validated OpenAPI 3.0 specification |
| **Entity Relationship Diagram** | [`docs/ER.md`](docs/ER.md) | Mermaid ER diagram covering all 18 tables and constraints |
| **Technical Architecture Report** | [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) | Architectural decisions, integrity, security, and audit report |
| **Test Evidence & Execution Logs** | [`docs/TEST_EVIDENCE.md`](docs/TEST_EVIDENCE.md) | Raw terminal logs, test matrices, and proof of constraints |
| **Module Walkthrough Guide** | [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) | Module-by-module breakdown and reviewer interview Q&As |

---

## Demo Credentials (Dummy Passwords Only)

All demo accounts use the standard dummy password: `Password123!`

| Role | Email | Description | Key Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@aarogya.local` | System Administrator | Directory management, audit log viewer, encounter metadata |
| **Front Desk** | `frontdesk1@aarogya.local` | Receptionist | Patient demographics (CRUD), appointments, billing & payments |
| **Front Desk** | `frontdesk2@aarogya.local` | Desk Coordinator | Patient demographics (CRUD), appointments, billing & payments |
| **Front Desk** | `frontdesk3@aarogya.local` | Patient Services | Patient demographics (CRUD), appointments, billing & payments |
| **Clinician** | `dr.sharma@aarogya.local` | Cardiology | Own appointments, treated patients, clinical notes for those patients |
| **Clinician** | `dr.verma@aarogya.local` | Orthopedics | Own appointments, treated patients, clinical notes for those patients |
| **Clinician** | `dr.iyer@aarogya.local` | Pediatrics | Own appointments, treated patients, clinical notes for those patients |
| **Clinician** | `dr.singh@aarogya.local` | Ophthalmology | Own appointments, treated patients, clinical notes for those patients |

---

## Architecture Overview

A modular monolith structured strictly by layered separation of concerns:
```
Routes  ──>  Controllers  ──>  Services (Business Logic)  ──>  Repositories (Plain SQL)
```
- **No SQL in controllers or routes**.
- **Server-side RBAC on every protected route** (`admin`, `clinician`, `front_desk`).
- **PostgreSQL `btree_gist` Exclusion Constraints** for physical double-booking prevention (`SQLSTATE 23P01` &rarr; 409 `SLOT_TAKEN`).
- **Append-only Audit Log** enforced by PostgreSQL DB trigger rejecting any `UPDATE` or `DELETE` with `SQLSTATE 55000`.
- **All monetary calculations** stored as integer paise (`BIGINT`).
- **Fixed Hospital Timezone**: `Asia/Kolkata` (UTC+05:30). All schedules and slot calculations are processed in local hospital time and stored as UTC `TIMESTAMPTZ`.
- **Clinician-entered notes only**: Zero automated diagnosis or algorithmic medical decision making.

---

## Implementation Status

| Area | Status |
|---|---|
| Backend API: auth, RBAC, audit, patients, directory, slots, appointments, encounters, clinical records, billing, reports | Implemented, documented (`/api/docs`) and tested against a real PostgreSQL database |
| Web UI (React 18, Vite, Tailwind) | Built: sign-in, front desk, clinician and admin screens (see **Run the web app**). Tested by driving the real UI against the real API |
| Real payment gateway, file storage, email/SMS | Not implemented (see below) |

## Known Limitations & Assumptions

These are real gaps and deliberate simplifications, not hypothetical future work.

1. **The web UI has not been through a manual cross-browser pass.** It is covered by automated UI tests (jsdom, real API and database) but was not checked on real phones or in Safari or Firefox.
2. **Payments are a sandbox simulation.** Only three fixed test cards behave differently (`4242424242424242` succeeds; `4000000000000002` and `4000000000009995` are declined). There is no real gateway, no webhooks and **no refunds**. Only the last four card digits are ever stored.
3. **Tax and discounts are plain amounts** supplied by the front desk (in paise). There is no GST rule engine, no tax-rate table and no discount-approval workflow.
4. **Diagnostic reports store metadata only** (test name, category, date, file name). No file upload or object storage exists.
5. **No structured vitals.** Examination findings are free text inside clinical notes.
6. **Deactivating a doctor does not touch their future appointments.** Access is revoked immediately (login and existing sessions stop working), but upcoming appointments stay `scheduled` and need to be cancelled or rebooked by the front desk.
7. **Idempotency replays failures too.** Any response below HTTP 500 is stored under the key, including 4xx errors such as `422` or `409 SLOT_TAKEN`. A corrected retry must use a **new** key. A duplicate that arrives while the first request is still running gets `409 IDEMPOTENCY_IN_PROGRESS` instead of waiting. Expired keys are not purged on a schedule.
8. **The audit log stores patient demographic before/after snapshots** on updates (this is what makes edits reviewable), and admins can read the log. It deliberately never stores clinical note, prescription or card content, only ids and counts.
9. **No password reset, MFA or account lockout.** Brute force is limited only by the login rate limiter.
10. **Rate limiting is in process memory.** A multi-instance deployment would need a shared store such as Redis.
11. **Single hospital timezone.** All schedule logic assumes `Asia/Kolkata`. Multiple facilities would need per-facility timezone metadata.
12. **Search uses `ILIKE`** without trigram or full-text indexes. Fine at demo scale, not at millions of rows.
13. **Connection pool is 20 per process.** Larger deployments would put PgBouncer in front.
14. **Synthetic data only.** The system is a demo and must never hold real patient data. It never suggests diagnoses and gives no drug-interaction or dosing advice; clinical decisions are entirely the clinician's.
