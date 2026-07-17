-- Add client_id and client_name to contracts and proposals
-- Run this in the Supabase SQL Editor to enable full client linking.

-- ── Contracts ─────────────────────────────────────────────────────────────────
alter table contracts add column if not exists client_id   text not null default '';
alter table contracts add column if not exists client_name text not null default '';

create index if not exists contracts_client_id_idx on contracts (client_id);

-- ── Proposals (client_name only — client_id was added in migration 007) ───────
alter table proposals add column if not exists client_name text not null default '';

create index if not exists proposals_client_name_idx on proposals (client_name);
