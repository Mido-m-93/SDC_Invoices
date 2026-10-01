-- Link to the matched member's contract file in SharePoint, cached alongside
-- the other contract fields so invoice validation can show a "View Contract"
-- link for a locally-matched contractor without a live SharePoint fetch.
-- Run this in Supabase SQL Editor.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contract_file_url text;
