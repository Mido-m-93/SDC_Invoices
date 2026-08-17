-- Phase 10: Monthly Close Checklist
-- Run in Supabase SQL Editor

create table if not exists monthly_checklist (
  id            text primary key,            -- "{month}-{nn}", e.g. "2026-06-01"
  month         text not null,               -- "YYYY-MM"
  category      text not null,               -- "invoices" | "expenses" | "outbound" | "bank" | "tax" | "payroll" | "reporting"
  title         text not null,
  description   text,
  status        text not null default 'pending',  -- "pending" | "done" | "skipped" | "blocked"
  completed_by  text,
  completed_at  timestamptz,
  notes         text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists monthly_checklist_month_idx on monthly_checklist (month);
