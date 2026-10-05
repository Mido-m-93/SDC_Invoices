-- Tracks when a filed invoice was marked as paid, for the Invoices page's
-- "Paid" filter tab (replacing the "Already Processed" one).
-- Run this in Supabase SQL Editor.

ALTER TABLE filed_documents
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
