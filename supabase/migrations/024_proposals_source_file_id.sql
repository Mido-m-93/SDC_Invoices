-- Track the SharePoint file each synced proposal came from, so re-running
-- /api/proposals/sync can skip files already imported instead of creating
-- a duplicate proposal row every time the sync runs.

alter table proposals add column if not exists source_file_id text;
