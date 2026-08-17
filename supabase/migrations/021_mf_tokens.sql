-- Store MoneyForward OAuth tokens in app_config so they persist
-- across Vercel serverless function restarts and auto-refresh correctly.
alter table app_config
  add column if not exists mf_access_token  text not null default '',
  add column if not exists mf_refresh_token text not null default '';
