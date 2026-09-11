-- Budget stage: new table + the contract link, first step of completing the
-- document chain Proposal → Budget → Contract → Invoice → Cash.
-- Purely additive — safe to run any time, no coordinated code deploy needed.
-- (The verification-column renames on contracts/outbound_invoices that also
-- belong to this chain ship in later migrations, paired with the code that
-- consumes the new column names — renaming now would break the live app,
-- which still reads/writes those columns under their current names.)
-- Run this in Supabase SQL Editor.

-- ── Budgets ──────────────────────────────────────────────────────────────────
create table if not exists budgets (
  id                    text primary key,
  client_id             text not null default '',
  client_name           text not null default '',
  proposal_id           text,                          -- proposal this budget was raised from
  project_name          text not null,
  budget_amount         numeric not null default 0,
  currency              text not null default 'JPY',
  budget_date           text not null,                 -- "YYYY-MM-DD"
  status                text not null default 'draft', -- "draft" | "confirmed" | "rejected"
  description           text not null default '',
  folder_url            text,
  source_file_id        text,                           -- SharePoint Graph item id, when synced — dedups re-syncs
  verification_proposal jsonb,                          -- AI check: this budget vs. its proposal
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,                    -- soft-delete — set when moved to Archives, cleared on restore
  deleted_by            text
);

create index if not exists budgets_client_id_idx    on budgets (client_id);
create index if not exists budgets_proposal_id_idx  on budgets (proposal_id);
create index if not exists budgets_status_idx       on budgets (status);

-- ── Contracts: link to budget ─────────────────────────────────────────────────
-- status also gains "draft" | "signed" ahead of "active" (app-layer only, no
-- DB check constraint exists on this column today).
alter table contracts add column if not exists budget_id text;
create index if not exists contracts_budget_id_idx on contracts (budget_id);
