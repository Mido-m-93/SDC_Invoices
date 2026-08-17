-- Phase 8: Expense Reimbursement Claims
create table if not exists expense_claims (
  id                    text primary key,
  submitted_by          text not null default '',
  submitted_by_email    text not null default '',
  submitted_at          timestamptz not null default now(),
  category              text not null default 'other',
  description           text not null default '',
  amount                numeric not null default 0,
  currency              text not null default 'JPY',
  payment_method        text not null default 'personal_reimbursement',
  receipt_url           text not null default '',
  receipt_filename      text not null default '',
  project_name          text not null default '',
  internal_department   text not null default '',
  expense_date          date,
  status                text not null default 'submitted',
  reviewer_comment      text not null default '',
  reviewed_by           text not null default '',
  reviewed_at           timestamptz,
  approved_by           text not null default '',
  approved_at           timestamptz,
  paid_at               timestamptz,
  extracted_amount      numeric,
  extracted_date        date,
  extracted_vendor      text,
  policy_violations     text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists expense_claims_status_idx on expense_claims(status);
create index if not exists expense_claims_submitted_by_idx on expense_claims(submitted_by);
create index if not exists expense_claims_submitted_at_idx on expense_claims(submitted_at desc);
