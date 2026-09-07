-- Restrict new Supabase Auth accounts to @roboco-op.org emails only.
-- Enforced at the database level (not just client-side) so it can't be
-- bypassed by calling the Supabase Auth API directly.
create or replace function public.enforce_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) !~ '^[^@]+@roboco-op\.org$' then
    raise exception 'Sign-up is restricted to @roboco-op.org email addresses';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_email_domain on auth.users;

create trigger enforce_signup_email_domain
  before insert on auth.users
  for each row
  execute function public.enforce_signup_email_domain();
