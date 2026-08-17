-- Money Forward billing reference fields, for both invoices and expense claims.
-- Run this in Supabase SQL Editor.

ALTER TABLE invoice_validations
  ADD COLUMN IF NOT EXISTS mf_billing_id  text,
  ADD COLUMN IF NOT EXISTS mf_billing_url text,
  ADD COLUMN IF NOT EXISTS mf_sent_at     timestamptz;

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS mf_billing_id  text,
  ADD COLUMN IF NOT EXISTS mf_billing_url text,
  ADD COLUMN IF NOT EXISTS mf_sent_at     timestamptz;
