# Aarogya HMS — Hospital Management System

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
![Node 20](https://img.shields.io/badge/node-20.x-green.svg)
![PostgreSQL 16](https://img.shields.io/badge/postgresql-16-blue.svg)
![License](https://img.shields.io/badge/license-MIT-purple.svg)

> **DEMO SYSTEM NOTICE**: This repository and database contain strictly **SYNTHETIC DATA ONLY**. No real patient or clinician data is used anywhere in this system.

Aarogya HMS is an enterprise-grade Hospital Management System designed for high clinical explainability, zero race-condition tolerance, server-side role-based access control (RBAC), and append-only auditing.

---

## Reviewer Quick Start

Follow these exact Windows PowerShell commands from initial repository clone to running the system and running all verified test suites:

### 1. Copy Environment File
```powershell
Copy-Item .env.example .env
```

### 2. Start PostgreSQL 16 via Docker
```powershell
docker compose up -d
```
*(Starts PostgreSQL 16 container with healthchecks and creates both `aarogya_hms` and `aarogya_hms_test` databases on port 5432).*

### 3. Install Dependencies
```powershell
npm install
```

### 4. Run Migrations & Synthetic Seed
```powershell
npm run migrate
npm run seed
```

### 5. Run All Real Database Automated Tests
```powershell
npm test
```

### 6. Run the Live Race Condition Double-Booking Demo
```powershell
npm run demo:race
```

### 7. Start the Development Server
```powershell
npm run dev
```

---

## Key Reviewer Documentation & Artifacts

| Document | Location | Purpose |
| :--- | :--- | :--- |
| **Interactive API Docs** | [http://localhost:5000/api/docs](http://localhost:5000/api/docs) | Swagger UI for live endpoint exploration |
| **Committed Static OpenAPI Spec** | [`docs/openapi.yaml`](docs/openapi.yaml) | Validated OpenAPI 3.0 specification |
| **Entity Relationship Diagram** | [`docs/ER.md`](docs/ER.md) | Mermaid ER diagram covering all 18 tables and constraints |
| **Technical Architecture Report** | [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) | Complete architectural decisions, security, and integrity report |
| **Test Evidence & Logs** | [`docs/TEST_EVIDENCE.md`](docs/TEST_EVIDENCE.md) | Raw terminal logs, test matrices, and proof of constraints |
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
- **Clinician-entered notes only**: Zero automated diagnosis or algorithmic medical decision making.

---

## RBAC Matrix Summary

| Resource | Action | Admin | Clinician | Front Desk | Conditions |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Directory** | Read | YES | YES | YES | Public department / staff lookup |
| **Directory** | Write | YES | NO | NO | Department & schedule configurations |
| **Patients** | Read | YES | YES | YES | Clinicians only view treated patients |
| **Patients** | Create / Edit | NO | NO | YES | Front desk patient registration |
| **Clinical Notes** | Read / Write | NO | YES | NO | **Strictly treating clinician only**. Admin/Front desk forbidden |
| **Billing / Invoices** | Read / Write | YES | NO | YES | Clinicians cannot view or edit billing |
| **Audit Logs** | Read | YES | NO | NO | **System Administrator only**. Append-only DB trigger |

*Every denial returns `403 FORBIDDEN` and automatically logs an audit entry with request details.*

---

## Available NPM Scripts

- `npm run dev`: Start backend with hot reload (`node --watch`).
- `npm run start`: Start production server.
- `npm run migrate`: Execute unapplied SQL migrations.
- `npm run seed`: Run idempotent synthetic data seed.
- `npm test`: Run full Vitest suite against real PostgreSQL test database.
- `npm run demo:race`: Run the live race condition double-booking demonstration script.
- `npm run docs:openapi`: Validate OpenAPI specification and sync `docs/openapi.yaml`.
- `npm run lint`: Perform clean recursive syntax verification on all JS files.

---

## Known Limitations

- **Phase 1 Scope**: Phase 1 includes backend foundation, database schema, migrations, seed, auth, RBAC matrix, and audit logging. Interactive appointment booking workflows, front-desk UI, and clinician console are scheduled for subsequent phases.
