-- Proposals and Payment Records
-- Completes the document chain: Proposal → Contract → Invoice → Payment
-- Run in Supabase SQL Editor

-- ── Proposals ────────────────────────────────────────────────────────────────
create table if not exists proposals (
  id                  text primary key,
  vendor_id           text not null,
  project_name        text not null,
  proposal_date       text not null,              -- "YYYY-MM-DD"
  estimated_amount    numeric not null default 0,
  currency            text not null default 'JPY',
  description         text not null default '',
  status              text not null default 'draft',  -- "draft" | "submitted" | "accepted" | "rejected" | "expired"
  contract_id         text,                       -- set when proposal is accepted and contract is created
  folder_url          text,                       -- link to centralized contract/proposal folder
  created_at          timestamptz not null default now()
);

create index if not exists proposals_vendor_id_idx   on proposals (vendor_id);
create index if not exists proposals_status_idx      on proposals (status);
create index if not exists proposals_contract_id_idx on proposals (contract_id);

-- ── Contract: add proposal linkage and folder url ────────────────────────────
alter table contracts add column if not exists proposal_id      text;
alter table contracts add column if not exists contract_folder_url text;

create index if not exists contracts_proposal_id_idx on contracts (proposal_id);

-- ── Payment records ───────────────────────────────────────────────────────────
create table if not exists payment_records (
  id                  text primary key,
  invoice_id          text not null,
  contract_id         text not null,
  vendor_id           text not null,
  amount              numeric not null default 0,
  currency            text not null default 'JPY',
  payment_date        text not null,              -- "YYYY-MM-DD"
  payment_method      text not null default '',
  reference_number    text not null default '',
  status              text not null default 'pending',  -- "pending" | "confirmed" | "failed" | "reconciled"
  confirmed_by        text,
  confirmed_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists payment_records_invoice_id_idx  on payment_records (invoice_id);
create index if not exists payment_records_contract_id_idx on payment_records (contract_id);
create index if not exists payment_records_vendor_id_idx   on payment_records (vendor_id);
create index if not exists payment_records_status_idx      on payment_records (status);
