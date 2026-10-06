-- Every new Supabase Auth account starts pending until an admin approves it.
-- Enforced at the database level (not just in the sign-up form) so it can't be
-- bypassed by calling the Supabase Auth API directly. The app refuses pending
-- users (see src/lib/authz.ts); existing accounts have no flag and stay approved.
-- Requires 051_authz_to_app_metadata.sql.
create or replace function public.mark_signup_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('approval', 'pending');
  return new;
end;
$$;

drop trigger if exists mark_signup_pending on auth.users;

create trigger mark_signup_pending
  before insert on auth.users
  for each row
  execute function public.mark_signup_pending();
