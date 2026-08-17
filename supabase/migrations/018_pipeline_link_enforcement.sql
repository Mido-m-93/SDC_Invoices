-- Pipeline link enforcement + AI consistency verification storage.
-- Run this in Supabase SQL Editor.
--
-- NOTE: columns are added nullable on purpose — leads.proposal_id,
-- contracts.proposal_id, proposals.contract_id already have existing null
-- rows, and adding NOT NULL now would break them. The Lead→Proposal→Contract
-- links are enforced at the application layer (API routes) instead; revisit
-- NOT NULL here once existing data is backfilled.

alter table proposals
  add column if not exists lead_id      text,
  add column if not exists verification jsonb;

alter table contracts
  add column if not exists verification jsonb;

alter table invoice_validations
  add column if not exists contract_verification jsonb;

create index if not exists proposals_lead_id_idx on proposals (lead_id);
