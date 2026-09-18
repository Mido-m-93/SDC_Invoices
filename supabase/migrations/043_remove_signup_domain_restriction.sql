-- Open sign-up to any email domain, not just @roboco-op.org.
-- Removes the trigger added in 031_restrict_signup_domain.sql.
drop trigger if exists enforce_signup_email_domain on auth.users;
drop function if exists public.enforce_signup_email_domain();
