-- Phase 8: Expense Claims
-- Run in Supabase SQL Editor

create table if not exists expense_claims (
  id                  text primary key,
  submitted_by        text not null,
  submitted_by_email  text not null,
  submitted_at        timestamptz not null default now(),
  category            text not null,
  purpose             text not null,
  amount              numeric(15,2) not null,
  currency            text not null default 'JPY',
  receipt_attachment  text,
  receipt_filename    text,
  project_name        text,
  notes               text,
  status              text not null default 'submitted',
  issues              text[] not null default '{}',
  reviewed_by         text,
  reviewed_at         timestamptz,
  reviewer_comment    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists expense_claims_status_idx       on expense_claims (status);
create index if not exists expense_claims_submitted_at_idx on expense_claims (submitted_at desc);

-- Row-level security (optional — enable if using Supabase Auth)
-- alter table expense_claims enable row level security;
