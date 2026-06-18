-- Phase 11: Client Management, Lead Management, Member Management, Accounting Layer
-- Completes the full workflow chain: Lead → Proposal → Contract → Invoice → Payment → Accounting → Reporting

-- ── Clients ───────────────────────────────────────────────────────────────────
create table if not exists clients (
  id                      text primary key,
  name                    text not null,
  legal_name              text not null default '',
  industry                text not null default '',
  contact_name            text not null default '',
  contact_email           text not null default '',
  contact_phone           text not null default '',
  address                 text not null default '',
  country                 text not null default 'JP',
  tax_registration_number text not null default '',
  status                  text not null default 'prospect',
  notes                   text not null default '',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists clients_status_idx on clients (status);
create index if not exists clients_name_idx   on clients (name);

-- ── Leads ─────────────────────────────────────────────────────────────────────
create table if not exists leads (
  id                  text primary key,
  client_id           text not null default '',
  client_name         text not null default '',
  contact_name        text not null default '',
  contact_email       text not null default '',
  source              text not null default 'inbound',
  stage               text not null default 'new',
  title               text not null,
  estimated_value     numeric not null default 0,
  currency            text not null default 'JPY',
  probability         integer not null default 50,
  expected_close_date text not null default '',
  assigned_to         text not null default '',
  proposal_id         text,
  notes               text not null default '',
  lost_reason         text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists leads_client_id_idx  on leads (client_id);
create index if not exists leads_stage_idx      on leads (stage);
create index if not exists leads_assigned_to_idx on leads (assigned_to);
create index if not exists leads_proposal_id_idx on leads (proposal_id);

-- ── Members ───────────────────────────────────────────────────────────────────
create table if not exists members (
  id              text primary key,
  display_name    text not null,
  email           text not null default '',
  phone           text not null default '',
  role            text not null default 'other',
  department      text not null default '',
  employee_code   text not null default '',
  join_date       text not null default '',
  status          text not null default 'active',
  avatar_url      text not null default '',
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists members_status_idx on members (status);
create index if not exists members_role_idx   on members (role);
create unique index if not exists members_email_idx on members (email) where email <> '';

-- ── Accounting Entries ────────────────────────────────────────────────────────
create table if not exists accounting_entries (
  id              text primary key,
  entry_date      text not null,
  month           text not null,
  type            text not null,
  category        text not null default '',
  description     text not null default '',
  amount          numeric not null default 0,
  currency        text not null default 'JPY',
  exchange_rate   numeric not null default 1,
  amount_jpy      numeric not null default 0,
  status          text not null default 'draft',
  source_type     text not null default 'manual',
  source_id       text not null default '',
  client_id       text not null default '',
  vendor_id       text not null default '',
  member_id       text not null default '',
  notes           text not null default '',
  posted_by       text not null default '',
  posted_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists accounting_entries_month_idx     on accounting_entries (month);
create index if not exists accounting_entries_type_idx      on accounting_entries (type);
create index if not exists accounting_entries_status_idx    on accounting_entries (status);
create index if not exists accounting_entries_source_idx    on accounting_entries (source_type, source_id);
create index if not exists accounting_entries_client_id_idx on accounting_entries (client_id);
create index if not exists accounting_entries_vendor_id_idx on accounting_entries (vendor_id);

-- ── Link proposals to clients ─────────────────────────────────────────────────
alter table proposals add column if not exists client_id text not null default '';
create index if not exists proposals_client_id_idx on proposals (client_id);
