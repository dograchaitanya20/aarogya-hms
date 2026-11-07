-- 003_idempotency_user_scope.sql
-- Scope idempotency keys by (user_id, request_method, request_path, idempotency_key)

ALTER TABLE idempotency_keys
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Drop old single-column unique constraint if exists
ALTER TABLE idempotency_keys
DROP CONSTRAINT IF EXISTS idempotency_keys_idempotency_key_key;

-- Drop index if created earlier
DROP INDEX IF EXISTS idx_idempotency_user_scope;

-- Add scoped unique constraint
ALTER TABLE idempotency_keys
DROP CONSTRAINT IF EXISTS uq_idempotency_scope;

ALTER TABLE idempotency_keys
ADD CONSTRAINT uq_idempotency_scope UNIQUE NULLS NOT DISTINCT (user_id, request_method, request_path, idempotency_key);
