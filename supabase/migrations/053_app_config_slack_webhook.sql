-- Slack incoming-webhook URL for reminders, next to the existing Teams one
-- (teams_webhook_url). Empty string = Slack not connected.
alter table app_config
  add column if not exists slack_webhook_url text not null default '';
