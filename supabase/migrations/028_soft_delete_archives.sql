-- Adds soft-delete columns to every table getting a Delete + Undo + Archives
-- flow: proposals, staged_pipeline_records, expense_claims,
-- outbound_invoices, invoice_submissions. A row with deleted_at set is
-- excluded from normal list views but kept (not hard-deleted) so it can be
-- restored from the new /archives page.

alter table proposals add column if not exists deleted_at timestamptz;
alter table proposals add column if not exists deleted_by text;

alter table staged_pipeline_records add column if not exists deleted_at timestamptz;
alter table staged_pipeline_records add column if not exists deleted_by text;

alter table expense_claims add column if not exists deleted_at timestamptz;
alter table expense_claims add column if not exists deleted_by text;

alter table outbound_invoices add column if not exists deleted_at timestamptz;
alter table outbound_invoices add column if not exists deleted_by text;

alter table invoice_submissions add column if not exists deleted_at timestamptz;
alter table invoice_submissions add column if not exists deleted_by text;

create index if not exists proposals_deleted_at_idx on proposals (deleted_at);
create index if not exists staged_pipeline_records_deleted_at_idx on staged_pipeline_records (deleted_at);
create index if not exists expense_claims_deleted_at_idx on expense_claims (deleted_at);
create index if not exists outbound_invoices_deleted_at_idx on outbound_invoices (deleted_at);
create index if not exists invoice_submissions_deleted_at_idx on invoice_submissions (deleted_at);
