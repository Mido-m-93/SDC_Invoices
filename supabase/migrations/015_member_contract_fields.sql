-- Contract fields extracted from SharePoint contract PDFs, cached on the member
-- record so invoice validation doesn't need to re-fetch/re-extract on every call.
-- Run this in Supabase SQL Editor.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contract_start    date,
  ADD COLUMN IF NOT EXISTS contract_end      date,
  ADD COLUMN IF NOT EXISTS contracted_amount numeric,
  ADD COLUMN IF NOT EXISTS contract_scope    text;
