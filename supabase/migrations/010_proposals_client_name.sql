-- Add client_name to proposals for denormalized display
-- The client_id FK already exists (added in 007); client_name avoids a join on every list view.

alter table proposals add column if not exists client_name text not null default '';

create index if not exists proposals_client_name_idx on proposals (client_name);
