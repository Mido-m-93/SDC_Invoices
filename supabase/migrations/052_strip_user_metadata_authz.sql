-- Cleanup after the account-approval code is deployed (see 051).
-- RUN AFTER DEPLOYING. Removes the old, user-editable copies of role and
-- allowedTabs from user_metadata. The app no longer reads them; this just stops
-- stale values lingering. (Running it before the deploy would drop admin access
-- in the old code until the new code is live.)
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'role' - 'allowedTabs'
where raw_user_meta_data ? 'role' or raw_user_meta_data ? 'allowedTabs';
