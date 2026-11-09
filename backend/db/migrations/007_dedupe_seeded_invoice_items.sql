-- 007_dedupe_seeded_invoice_items.sql
-- The seed script used ON CONFLICT DO NOTHING on invoice_items, which has no unique key, so every
-- re-seed inserted another copy of the seeded line item and invoice totals no longer matched their items.
-- The seed is fixed; this removes copies left in existing databases. Scoped to the seed's own line item.
DELETE FROM invoice_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id, description, quantity, unit_price_paise
             ORDER BY created_at, id
           ) AS rn
    FROM invoice_items
    WHERE description = 'Doctor Specialist Consultation'
  ) ranked
  WHERE rn > 1
);
