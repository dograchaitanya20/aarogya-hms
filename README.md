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

## Known Limitations & Architectural Assumptions

1. **Single Hospital Campus Timezone**: The system assumes a single primary hospital operating under `Asia/Kolkata` (IST, UTC+05:30). Supporting a multi-facility network across distinct timezones would require facility-level timezone metadata.
2. **In-Memory Rate Limiting**: The Express rate limiters (`apiLimiter`, `loginLimiter`) operate in Node.js process memory. In a multi-replica clustered production deployment, a distributed Redis-backed store (`rate-limit-redis`) is required to synchronize rate-limit windows across nodes.
3. **Connection Pooling Scale**: PostgreSQL pool is sized to 50 connections with a 10s timeout for local and test loads. For enterprise deployments handling thousands of concurrent staff, PgBouncer or Supavisor is recommended in transaction pooling mode.
4. **Binary Asset Storage**: Diagnostic report records store clinical metadata (patient, doctor, test type, results summary, status, timestamps). Large binary payloads (DICOM image stacks, high-res pathology slides, multi-page PDFs) are intentionally kept out of relational tables; an object store (S3/GCS/MinIO) with pre-signed upload/download URLs should be integrated for blob streaming.
5. **Simulated Payment Gateway**: The billing system models integer paise ledger reconciliation and rejects overpayment. Payment gateway processing is simulated for sandbox testing; real external webhooks (e.g. Razorpay/Stripe) require webhook signature verification endpoints.
6. **Appointment Cancellation Workflow**: Clinicians are strictly restricted from cancelling appointments directly (`403 FORBIDDEN`) to maintain front-desk scheduling integrity and avoid orphaned clinical slots; clinician schedule changes or cancellations must be coordinated through administrative front-desk staff.
7. **Idempotency Reaper Cadence**: Stale processing keys (>60s) are reaped opportunistically during incoming idempotency middleware execution. In high-traffic environments, a standalone background cron or pg_cron job should perform this cleanup to decouple it completely from request latency.
8. **No Algorithmic Clinical Decision Support**: Per non-negotiable requirements, the system strictly disallows automated diagnosis or drug-drug interaction warnings; prescription accuracy relies entirely on treating clinician judgment.
