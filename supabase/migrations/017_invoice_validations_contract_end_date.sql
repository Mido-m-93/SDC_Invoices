-- Registered contract's end date, cached on the validation result so Stage 4
-- can flag an expired contract without re-fetching the member record.
-- Run this in Supabase SQL Editor.

ALTER TABLE invoice_validations
  ADD COLUMN IF NOT EXISTS contract_end_date date;
