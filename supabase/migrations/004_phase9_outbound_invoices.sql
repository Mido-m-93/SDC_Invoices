-- Phase 9: Outbound Invoices
-- Run in Supabase SQL Editor

create table if not exists outbound_invoices (
  id              text primary key,
  client_name     text not null,
  client_email    text,
  project_name    text not null,
  contract_id     text,
  invoice_number  text,
  amount          numeric(15,2) not null,
  currency        text not null default 'JPY',
  billing_date    date not null,
  due_date        date,
  status          text not null default 'draft',
  notes           text,
  paid_at         timestamptz,
  drive_file_id   text,
  drive_file_url  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists outbound_invoices_status_idx   on outbound_invoices (status);
create index if not exists outbound_invoices_due_date_idx on outbound_invoices (due_date asc);
