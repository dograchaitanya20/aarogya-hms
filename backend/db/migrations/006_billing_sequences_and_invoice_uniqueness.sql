-- 006_billing_sequences_and_invoice_uniqueness.sql
-- Atomic invoice/payment numbers, one live invoice per appointment, invoice cancellation reason.

CREATE SEQUENCE IF NOT EXISTS seq_invoice_number START WITH 100001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_payment_number START WITH 100001 INCREMENT BY 1;

ALTER TABLE invoices
ALTER COLUMN invoice_number SET DEFAULT ('INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_invoice_number')::TEXT, 6, '0'));

ALTER TABLE payments
ALTER COLUMN payment_number SET DEFAULT ('PAY-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_payment_number')::TEXT, 6, '0'));

-- An appointment can have at most one non-cancelled invoice (prevents double billing)
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_one_per_appointment
ON invoices (appointment_id)
WHERE appointment_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
