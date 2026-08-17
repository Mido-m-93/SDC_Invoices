-- Pipeline Sync: staged records + audit log
-- Previously stored in a mock file-based store (tmp-invoice-store.json), which
-- never persisted on Vercel since deployed functions have a read-only filesystem
-- outside /tmp, and /tmp itself isn't guaranteed to be shared across function
-- instances. Moving to Supabase so sync results actually persist in production.

create table if not exists staged_pipeline_records (
  id                 text primary key,
  source             text not null,
  source_ref         text not null default '',
  raw_client_name    text not null,
  project_name       text not null default '',
  stage_or_status    text not null default '',
  estimated_amount   numeric,
  currency           text not null default 'JPY',
  contact_name       text,
  contact_email      text,
  notes              text,
  matched_client_id  text,
  matched_client_name text,
  match_confidence   numeric not null default 0,
  match_candidates   jsonb not null default '[]'::jsonb,
  status             text not null default 'needs_review',
  reviewer_comment   text,
  created_lead_id    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists staged_pipeline_records_status_idx on staged_pipeline_records (status);
create index if not exists staged_pipeline_records_source_idx on staged_pipeline_records (source);

create table if not exists pipeline_sync_audit_log (
  id          text primary key,
  timestamp   timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  record_id   text,
  source      text,
  detail      text not null default ''
);
create index if not exists pipeline_sync_audit_log_record_id_idx on pipeline_sync_audit_log (record_id);
create index if not exists pipeline_sync_audit_log_timestamp_idx on pipeline_sync_audit_log (timestamp);
