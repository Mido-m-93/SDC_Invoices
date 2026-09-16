-- Tracks two more steps of the sales process checklist:
--   1-2 "Registered with Salesforce" (Deal Registration) → leads
--   2-1 "Create a quote/price sheet" and
--   2-2 "Internal interviews and consent" (Internal Approval) → proposals
-- (3-2 "preliminary notice" was already added in 038.)

alter table leads add column if not exists salesforce_registered_at timestamptz;
alter table leads add column if not exists salesforce_url text;

alter table proposals add column if not exists quote_sheet_created_at timestamptz;
alter table proposals add column if not exists quote_sheet_url text;
alter table proposals add column if not exists internal_approval_at timestamptz;
