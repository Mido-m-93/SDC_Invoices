-- Raw copy of the SharePoint Excel workbook, fetched via Microsoft Graph.
-- Stored generically (one JSON object per row) so column changes in Excel
-- never need a schema migration; column mapping comes later, on top of this.
--
-- Access: only the server (service role) touches these tables. RLS is enabled
-- with NO policies, so the public anon key can read nothing.

create table if not exists sheet_sync_sheets (
  id          uuid primary key default gen_random_uuid(),
  workbook_id text not null,
  sheet_name  text not null,
  position    integer not null default 0,
  headers     jsonb not null default '[]'::jsonb,
  row_count   integer not null default 0,
  synced_at   timestamptz not null default now(),
  unique (workbook_id, sheet_name)
);

create table if not exists sheet_sync_rows (
  sheet_id   uuid not null references sheet_sync_sheets(id) on delete cascade,
  row_number integer not null,            -- 1-based Excel row (header row = 1)
  cells      jsonb not null default '[]'::jsonb,  -- cell texts, same order as headers
  primary key (sheet_id, row_number)
);

alter table sheet_sync_sheets enable row level security;
alter table sheet_sync_rows   enable row level security;
