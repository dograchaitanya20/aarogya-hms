# Aarogya HMS — Hospital Management System

> **DEMO SYSTEM NOTICE**: This system contains strictly **SYNTHETIC DATA ONLY**. No real patient data exists in this repository or database.

Aarogya HMS is an enterprise-grade Hospital Management System designed for high integrity, clinical explainability, and server-side role-based access control.

---

## Architecture Overview

A modular monolith structured strictly by layered separation of concerns:
```
Routes  ──>  Controllers  ──>  Services (Business Logic)  ──>  Repositories (Plain SQL)
```
- **No SQL in controllers or routes**.
- **Server-side RBAC on every protected route** (`admin`, `clinician`, `front_desk`).
- **PostgreSQL `btree_gist` Exclusion Constraints** for physical double-booking prevention (`SQLSTATE 23P01` &rarr; 409 `SLOT_TAKEN`).
- **Append-only Audit Log** enforced by PostgreSQL DB trigger rejecting any `UPDATE` or `DELETE`.
- **All monetary calculations** stored as integer paise (`BIGINT`).
- **Clinician-entered notes only**: Zero automated diagnosis or algorithmic medical decision making.

---

## Tech Stack (Backend)

- **Runtime**: Node.js 20 (ES Modules)
- **Framework**: Express.js with Helmet, CORS, and Express-Rate-Limit
- **Database**: PostgreSQL 16 via native `pg` client
- **Validation**: Zod (standardized 422 error outputs)
- **Authentication**: bcrypt password hashing + JWT in `httpOnly` `SameSite=lax` cookies
- **Logging**: Pino structured logging with request ID correlation
- **Documentation**: OpenAPI 3 + Swagger UI served at `/api/docs`
- **Testing**: Vitest + Supertest testing against a real PostgreSQL test database

---

## Prerequisites

- **Node.js**: v20+ (`node -v`)
- **Docker & Docker Compose**: Docker Desktop with Linux containers enabled

---

## Quickstart Setup (Windows PowerShell / Bash)

### 1. Clone & Configure Environment
```powershell
cp .env.example .env
```

### 2. Start PostgreSQL 16
```powershell
docker compose up -d
```
*Healthcheck verifies PostgreSQL is running on port `5432` with databases `aarogya_hms` and `aarogya_hms_test`.*

### 3. Install Dependencies
```powershell
npm install
```

### 4. Run Migrations & Synthetic Seed
```powershell
npm run migrate
npm run seed
```

### 5. Run Test Suite
```powershell
npm test
```

### 6. Verify Race-Condition Double-Booking Prevention
```powershell
npm run demo:race
```

### 7. Start the Development Server
```powershell
npm run dev
```
- Server API: [http://localhost:5000](http://localhost:5000)
- Health Check: [http://localhost:5000/api/v1/health](http://localhost:5000/api/v1/health)
- OpenAPI Docs: [http://localhost:5000/api/docs](http://localhost:5000/api/docs)

---

## Demo Credentials (Synthetic Users)

All demo accounts use the standard dummy password: `Password123!`

| Role | Email | Description | Key Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@aarogya.local` | System Administrator | Directory management, audit log viewer, encounter metadata |
| **Front Desk** | `frontdesk1@aarogya.local` | Receptionist | Patient demographics (CRUD), appointments, billing & payments |
| **Front Desk** | `frontdesk2@aarogya.local` | Desk Coordinator | Patient demographics (CRUD), appointments, billing & payments |
| **Clinician** | `dr.sharma@aarogya.local` | Interventional Cardiology | Own appointments, patients treated, clinical notes for those patients |
| **Clinician** | `dr.verma@aarogya.local` | Orthopedics | Own appointments, patients treated, clinical notes for those patients |
| **Clinician** | `dr.iyer@aarogya.local` | Pediatrics | Own appointments, patients treated, clinical notes for those patients |
| **Clinician** | `dr.singh@aarogya.local` | Ophthalmology | Own appointments, patients treated, clinical notes for those patients |

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

## Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | Runtime environment (`development`, `test`, `production`) |
| `PORT` | `5000` | Port for Express HTTP server |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/aarogya_hms` | Development PostgreSQL connection string |
| `TEST_DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/aarogya_hms_test` | Isolated test database connection string |
| `JWT_SECRET` | *(string)* | Signing secret for JSON Web Tokens |
| `JWT_EXPIRES_IN` | `8h` | Session token lifetime |
| `COOKIE_SECRET` | *(string)* | Cookie signing secret |
| `LOG_LEVEL` | `info` | Pino log level (`info`, `debug`, `warn`, `error`) |

---

## Available NPM Scripts

- `npm run dev`: Start backend with hot reload (`node --watch`).
- `npm run start`: Start production server.
- `npm run migrate`: Execute unapplied SQL migrations.
- `npm run seed`: Run idempotent synthetic data seed.
- `npm test`: Run full Vitest suite against real PostgreSQL test database.
- `npm run demo:race`: Run the live race condition double-booking demonstration script.
- `npm run lint`: Perform clean recursive syntax verification on all JS files.

---

## Known Limitations

- **Phase 1 Scope**: Phase 1 includes backend foundation, database schema, migrations, seed, auth, RBAC matrix, and audit logging. Appointment lifecycle workflows, idempotency middleware, billing reconciliation, and frontend UI are scheduled for subsequent phases.
