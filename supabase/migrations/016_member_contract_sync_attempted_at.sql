-- Tracks when a contract-extraction attempt was made (success or failure), so
-- members whose contract PDF can't be read don't get retried on every single
-- sync run and permanently jam the front of the backfill queue.
-- Run this in Supabase SQL Editor.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contract_sync_attempted_at timestamptz;
