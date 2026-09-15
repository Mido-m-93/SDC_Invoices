-- Add contract-review-meeting and billing-rules-check tracking to contracts,
-- and preliminary award notice (内示) tracking to proposals — see
-- docs/PIPELINE_ARCHITECTURE.md deal-lifecycle notes.

alter table contracts
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists billing_rules_checked boolean not null default false,
  add column if not exists billing_rules_checked_at timestamptz,
  add column if not exists billing_rules_checked_by text;

alter table proposals
  add column if not exists preliminary_notice_date date;
