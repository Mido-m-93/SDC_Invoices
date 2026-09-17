-- Staged budget records: store the SharePoint file's webUrl so reviewers can
-- open the source file directly from the "Needs client review" queue.

alter table staged_budget_records
  add column if not exists file_url text;
