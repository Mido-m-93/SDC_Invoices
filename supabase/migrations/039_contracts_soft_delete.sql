-- Adds contracts to the soft-delete/Archives flow (see 028_soft_delete_archives.sql).
-- A row with deleted_at set is excluded from normal list views but kept
-- (not hard-deleted) so it can be restored from /archives.

alter table contracts add column if not exists deleted_at timestamptz;
alter table contracts add column if not exists deleted_by text;

create index if not exists contracts_deleted_at_idx on contracts (deleted_at);
