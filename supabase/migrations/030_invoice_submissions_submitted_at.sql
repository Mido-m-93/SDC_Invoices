-- Add submitted_at to invoice_submissions so the form submission date
-- persists in the DB and doesn't rely on the Excel file being readable on
-- every page load (which caused the column to show "—" when Sheets was slow).
ALTER TABLE invoice_submissions
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
