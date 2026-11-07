-- 004_sequences_for_mrn_and_appointments.sql
-- PostgreSQL sequences for deterministic, atomic MRN and Appointment Number generation

CREATE SEQUENCE IF NOT EXISTS seq_patient_mrn START WITH 100001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_appointment_number START WITH 100001 INCREMENT BY 1;

ALTER TABLE patients
ALTER COLUMN mrn SET DEFAULT ('MRN-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_patient_mrn')::TEXT, 6, '0'));

ALTER TABLE appointments
ALTER COLUMN appointment_number SET DEFAULT ('APT-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_appointment_number')::TEXT, 6, '0'));
