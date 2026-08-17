-- Permanently block specific synced expense claims from being re-imported.
-- Run this in Supabase SQL Editor.

-- 1. Create the blocklist table
CREATE TABLE IF NOT EXISTS expense_sync_blocklist (
  id         text PRIMARY KEY,
  blocked_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Move all current synced IDs into the blocklist before deleting them
INSERT INTO expense_sync_blocklist (id)
SELECT id FROM expense_claims
ON CONFLICT (id) DO NOTHING;

-- 3. Delete all expense claims
DELETE FROM expense_claims;
