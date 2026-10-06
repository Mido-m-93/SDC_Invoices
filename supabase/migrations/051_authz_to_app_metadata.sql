-- Move authorization (role, allowedTabs) from user_metadata to app_metadata.
-- user_metadata is editable by the user themselves via supabase.auth.updateUser(),
-- so any signed-in user could grant themselves admin. app_metadata is only
-- writable with the service role. The app now reads app_metadata only.
--
-- BEFORE RUNNING: review who currently claims admin — anyone listed here will
-- keep admin after this migration:
--   select email, raw_user_meta_data->>'role' as role
--   from auth.users where raw_user_meta_data->>'role' = 'admin';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'role', raw_user_meta_data->'role',
       'allowedTabs', raw_user_meta_data->'allowedTabs'
     ))
where raw_user_meta_data ? 'role' or raw_user_meta_data ? 'allowedTabs';

-- Remove the old, user-editable copies so nothing can drift back to reading them.
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'role' - 'allowedTabs'
where raw_user_meta_data ? 'role' or raw_user_meta_data ? 'allowedTabs';
