# Aarogya HMS — Entity Relationship Diagram

This document describes the relational database schema implemented in PostgreSQL 16.

## Schema Overview

All primary keys use UUID v4. Monetary amounts are strictly stored as `BIGINT` representing integer paise (1 INR = 100 paise) to prevent floating-point calculation inaccuracies.

```mermaid
erDiagram
    users ||--o| doctors : "has clinician profile"
    users ||--o{ appointments : "created_by"
    users ||--o{ invoices : "created_by"
    users ||--o{ payments : "created_by"
    users ||--o{ audit_log : "actor"

    departments ||--o{ doctors : "belongs to"
    departments ||--o{ appointments : "department"

    doctors ||--o{ doctor_schedules : "weekly schedule"
    doctors ||--o{ appointments : "consults"
    doctors ||--o{ encounters : "conducts"
    doctors ||--o{ clinical_notes : "author"
    doctors ||--o{ prescriptions : "prescribes"
    doctors ||--o{ diagnostic_reports : "orders"

    patients ||--o{ appointments : "books"
    patients ||--o{ encounters : "participates"
    patients ||--o{ clinical_notes : "subject"
    patients ||--o{ prescriptions : "receives"
    patients ||--o{ diagnostic_reports : "subject"
    patients ||--o{ invoices : "billed to"

    appointments ||--o| encounters : "realizes"
    appointments ||--o| invoices : "originates"

    encounters ||--o{ clinical_notes : "contains"
    encounters ||--o{ prescriptions : "contains"
    encounters ||--o{ diagnostic_reports : "references"

    prescriptions ||--|{ prescription_items : "contains medicines"

    invoices ||--|{ invoice_items : "contains line items"
    invoices ||--o{ payments : "reconciled with"

    users {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar role "admin | clinician | front_desk"
        varchar full_name
        varchar phone
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    departments {
        uuid id PK
        varchar name UK
        varchar code UK
        text description
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    doctors {
        uuid id PK
        uuid user_id FK,UK
        uuid department_id FK
        varchar specialization
        bigint consultation_fee_paise
        varchar room_number
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    patients {
        uuid id PK
        varchar mrn UK
        varchar full_name
        date date_of_birth
        varchar gender "male | female | other"
        varchar phone
        varchar email
        text address
        varchar emergency_contact_name
        varchar emergency_contact_phone
        varchar blood_group
        text allergies
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    doctor_schedules {
        uuid id PK
        uuid doctor_id FK
        smallint day_of_week "0=Sun .. 6=Sat"
        time start_time
        time end_time
        int slot_duration_minutes "10|15|20|30|45|60"
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    appointments {
        uuid id PK
        varchar appointment_number UK
        uuid patient_id FK
        uuid doctor_id FK
        uuid department_id FK
        timestamptz starts_at
        timestamptz ends_at
        varchar status "scheduled | checked_in | in_consultation | completed | cancelled | no_show"
        text reason_for_visit
        text cancellation_reason
        timestamptz checked_in_at
        timestamptz completed_at
        uuid created_by FK
        int version "Optimistic locking counter"
        timestamptz created_at
        timestamptz updated_at
    }

    encounters {
        uuid id PK
        uuid appointment_id FK,UK
        uuid patient_id FK
        uuid doctor_id FK
        timestamptz started_at
        timestamptz ended_at
        varchar status "in_progress | completed | cancelled"
        timestamptz created_at
        timestamptz updated_at
    }

    clinical_notes {
        uuid id PK
        uuid encounter_id FK
        uuid patient_id FK
        uuid doctor_id FK
        text chief_complaint
        text symptoms
        text clinical_examination
        text assessment_notes
        text plan
        text diagnosis_notes "Clinician-entered only"
        timestamptz created_at
        timestamptz updated_at
    }

    prescriptions {
        uuid id PK
        uuid encounter_id FK
        uuid patient_id FK
        uuid doctor_id FK
        text instructions
        timestamptz created_at
        timestamptz updated_at
    }

    prescription_items {
        uuid id PK
        uuid prescription_id FK
        varchar medicine_name
        varchar dosage
        varchar frequency
        int duration_days
        text instructions
        timestamptz created_at
    }

    diagnostic_reports {
        uuid id PK
        uuid encounter_id FK
        uuid patient_id FK
        uuid doctor_id FK
        varchar test_name
        varchar category "radiology | pathology | cardiology | other"
        date report_date
        varchar file_name
        varchar status "pending | completed | cancelled"
        text notes
        timestamptz created_at
        timestamptz updated_at
    }

    invoices {
        uuid id PK
        varchar invoice_number UK
        uuid patient_id FK
        uuid appointment_id FK
        bigint subtotal_paise
        bigint tax_paise
        bigint discount_paise
        bigint total_paise
        varchar status "unpaid | partial | paid | overpaid_rejected | cancelled"
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    invoice_items {
        uuid id PK
        uuid invoice_id FK
        varchar description
        int quantity
        bigint unit_price_paise
        bigint total_paise
        timestamptz created_at
    }

    payments {
        uuid id PK
        varchar payment_number UK
        uuid invoice_id FK
        bigint amount_paise
        varchar payment_method "cash | card | upi | net_banking"
        varchar status "success | failed | declined"
        varchar gateway_transaction_id
        varchar card_last_four
        text failure_reason
        uuid created_by FK
        timestamptz created_at
    }

    audit_log {
        uuid id PK
        timestamptz ts
        uuid actor_id FK
        varchar actor_role
        varchar action
        varchar entity_type
        varchar entity_id
        jsonb before_state
        jsonb after_state
        varchar ip_address
        text user_agent
        varchar request_id
        timestamptz created_at
    }

    idempotency_keys {
        uuid id PK
        varchar idempotency_key UK
        varchar request_path
        varchar request_method
        varchar request_hash
        int response_status
        jsonb response_headers
        jsonb response_body
        timestamptz created_at
        timestamptz expires_at
    }
```

## Key Database Constraints & Features

1. **Doctor Double-Booking Exclusion Constraint**:
   ```sql
   CONSTRAINT uq_doctor_slot_no_overlap EXCLUDE USING gist (
       doctor_id WITH =,
       tstzrange(starts_at, ends_at) WITH &&
   ) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'))
   ```
   Enforced at the storage engine level with `btree_gist`. Any race condition or overlapping insert/update raises SQLSTATE `23P01` and is converted to HTTP 409 `SLOT_TAKEN`.

2. **Patient Double-Booking Exclusion Constraint (Migration 002)**:
   ```sql
   CONSTRAINT uq_patient_slot_no_overlap EXCLUDE USING gist (
       patient_id WITH =,
       tstzrange(starts_at, ends_at) WITH &&
   ) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'))
   ```
   Enforced at the storage engine level. Prevents a single patient from holding overlapping appointments with multiple doctors simultaneously. Violation raises SQLSTATE `23P01` and is mapped to HTTP 409 `PATIENT_DOUBLE_BOOKED`.

2. **Immutable Audit Log**:
   ```sql
   CREATE TRIGGER trg_audit_log_append_only
   BEFORE UPDATE OR DELETE ON audit_log
   FOR EACH ROW
   EXECUTE FUNCTION prevent_audit_log_modification();
   ```
   Guarantees non-repudiation and tampering resistance. Any SQL `UPDATE` or `DELETE` attempt throws SQLSTATE `55000`.

3. **Strict Monetary Accounting**:
   All money stored in integer paise. Negative balances and discounts are strictly forbidden via DB check constraints:
   ```sql
   CONSTRAINT chk_invoice_math CHECK (total_paise = subtotal_paise + tax_paise - discount_paise)
   CONSTRAINT chk_item_total CHECK (total_paise = quantity * unit_price_paise)
   ```
