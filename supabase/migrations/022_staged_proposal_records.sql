-- Proposal Sync: review queue for SharePoint proposals with no confident
-- client match. Mirrors staged_pipeline_records (020) but scoped to
-- proposals.client_id, which is a NOT NULL FK into clients(id) — a proposal
-- can't be saved at all until a human picks (or creates) the right client.

create table if not exists staged_proposal_records (
  id                 text primary key,
  file_id            text not null,
  file_name          text not null,
  folder             text not null default '',
  raw_client_name    text not null default '',
  project_name       text not null default '',
  proposal_date      text,
  estimated_amount   numeric,
  currency           text not null default 'JPY',
  match_candidates   jsonb not null default '[]'::jsonb,
  status             text not null default 'needs_review',
  reviewer_comment   text,
  created_proposal_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists staged_proposal_records_status_idx on staged_proposal_records (status);
create unique index if not exists staged_proposal_records_file_id_idx on staged_proposal_records (file_id);
