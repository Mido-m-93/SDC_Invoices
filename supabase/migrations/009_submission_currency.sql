-- Add currency column to invoice_submissions for per-row currency override.
-- Values: JPY, USD, EUR, GBP, etc. NULL means default (JPY).
ALTER TABLE invoice_submissions ADD COLUMN IF NOT EXISTS currency text;
