-- 005_nullable_encounter_appointment.sql
-- Allow direct/walk-in/emergency encounters without a prior scheduled appointment
ALTER TABLE encounters ALTER COLUMN appointment_id DROP NOT NULL;
