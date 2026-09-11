-- Budget Sync: review queue for SharePoint budget files with no confident
-- client match. Mirrors staged_proposal_records (022).

create table if not exists staged_budget_records (
  id                 text primary key,
  file_id            text not null,
  file_name          text not null,
  folder             text not null default '',
  raw_client_name    text not null default '',
  project_name       text not null default '',
  budget_date        text,
  budget_amount      numeric,
  currency           text not null default 'JPY',
  match_candidates   jsonb not null default '[]'::jsonb,
  status             text not null default 'needs_review',
  reviewer_comment   text,
  created_budget_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists staged_budget_records_status_idx on staged_budget_records (status);
create unique index if not exists staged_budget_records_file_id_idx on staged_budget_records (file_id);
