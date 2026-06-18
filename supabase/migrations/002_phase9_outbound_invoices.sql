-- Phase 9: Outbound Invoice Tracking
create table if not exists outbound_invoices (
  id                text primary key,
  contract_id       text not null default '',
  client_id         text not null default '',
  client_name       text not null default '',
  project_name      text not null default '',
  invoice_number    text not null default '',
  billing_month     text not null,            -- YYYY-MM
  issue_date        date,
  due_date          date,
  subtotal          numeric not null default 0,
  tax_amount        numeric not null default 0,
  total             numeric not null default 0,
  currency          text not null default 'JPY',
  status            text not null default 'draft',
  notes             text not null default '',
  sent_at           timestamptz,
  paid_at           timestamptz,
  paid_amount       numeric,
  created_by        text not null default '',
  approved_by       text not null default '',
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists outbound_invoices_billing_month_idx on outbound_invoices(billing_month);
create index if not exists outbound_invoices_status_idx on outbound_invoices(status);
create index if not exists outbound_invoices_due_date_idx on outbound_invoices(due_date);
