-- Move authorization to app_metadata and approve every existing account.
-- RUN THIS BEFORE DEPLOYING the account-approval code. It's harmless to the old
-- code (which only reads user_metadata), and the new code fails closed: anyone
-- without app_metadata.approval = 'approved' (and not admin) is locked out.
--
-- Why: user_metadata is editable by the user themselves via
-- supabase.auth.updateUser(), so any signed-in user could grant themselves
-- admin. app_metadata is only writable with the service role.
--
-- BEFORE RUNNING: review who currently claims admin — anyone listed here will
-- keep admin after this migration:
--   select email, raw_user_meta_data->>'role' as role
--   from auth.users where raw_user_meta_data->>'role' = 'admin';

-- 1. Copy role / allowedTabs across.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'role', raw_user_meta_data->'role',
       'allowedTabs', raw_user_meta_data->'allowedTabs'
     ))
where raw_user_meta_data ? 'role' or raw_user_meta_data ? 'allowedTabs';

-- 2. Every account that exists today is approved. New sign-ups won't have the
--    flag and will wait for an admin.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"approval": "approved"}'::jsonb;

-- AFTER RUNNING, confirm at least one admin exists (otherwise nobody can approve):
--   select email from auth.users where raw_app_meta_data->>'role' = 'admin';
