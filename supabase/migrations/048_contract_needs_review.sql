-- Flags contract fields that came from the vision (scanned-image) extraction
-- path instead of the text path, so a human can confirm them before they're
-- trusted the same way text-extracted contract fields are.
-- Run this in Supabase SQL Editor.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contract_needs_review boolean;
