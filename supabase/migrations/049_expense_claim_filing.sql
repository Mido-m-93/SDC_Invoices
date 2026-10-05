-- Tracks whether an expense claim's receipt has been copied into the
-- "expense-receipts" Supabase Storage bucket (shown on the Reports page),
-- and whether it's been marked as paid out.
-- Run this in Supabase SQL Editor.
-- Also create a Storage bucket named "expense-receipts" (private) via the
-- Supabase dashboard — Storage → New bucket — before using this feature.

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS filed_storage_path text,
  ADD COLUMN IF NOT EXISTS filed_at timestamptz;
