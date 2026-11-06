-- 002_patient_exclusion_and_idempotency.sql
-- Aarogya HMS: Add patient double-booking exclusion constraint, optimistic locking version, and idempotency status

-- 1. Add optimistic locking version column to appointments
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- 2. Add second btree_gist exclusion constraint:
-- A patient cannot have overlapping appointments across any doctors in active statuses
ALTER TABLE appointments
ADD CONSTRAINT uq_patient_slot_no_overlap EXCLUDE USING gist (
    patient_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
) WHERE (status IN ('scheduled', 'checked_in', 'in_consultation', 'completed'));

-- 3. Add status column to idempotency_keys to handle concurrent in-progress requests
ALTER TABLE idempotency_keys
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed';
