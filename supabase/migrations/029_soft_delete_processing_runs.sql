-- Extends the soft-delete/Archives flow (028) to Processing Logs' "Clear
-- Logs" action, which was still a genuine hard delete of processing_runs
-- (processing_logs cascaded via FK). Logs themselves are left untouched —
-- only the run row is soft-deleted, so a restored run keeps its log history.

alter table processing_runs add column if not exists deleted_at timestamptz;
alter table processing_runs add column if not exists deleted_by text;

create index if not exists processing_runs_deleted_at_idx on processing_runs (deleted_at);
