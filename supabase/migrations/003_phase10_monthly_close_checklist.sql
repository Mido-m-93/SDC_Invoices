-- Phase 10: Monthly Close Checklist
create table if not exists monthly_close_checklists (
  id           text primary key,
  month        text not null,    -- YYYY-MM
  category     text not null default '',
  title        text not null default '',
  title_ja     text not null default '',
  description  text not null default '',
  status       text not null default 'pending',
  assignee     text not null default '',
  completed_by text not null default '',
  completed_at timestamptz,
  notes        text not null default '',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists monthly_close_month_idx on monthly_close_checklists(month);
create index if not exists monthly_close_sort_idx on monthly_close_checklists(month, sort_order);
