-- Member feedback: a simple in-app form any logged-in member can submit
-- (rating + category + free-text message), viewable by admins only.
create table if not exists feedback (
  id          text primary key,
  user_id     text not null default '',
  user_email  text not null default '',
  rating      integer not null,
  category    text not null default 'other',
  message     text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on feedback (created_at);
