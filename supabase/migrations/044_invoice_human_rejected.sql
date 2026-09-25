-- Adds the reviewer-reject counterpart to human_approved/approved_by
-- (see 000_core_invoice_tables.sql), so a rejected invoice's decision
-- persists across reloads instead of only living in client state.
alter table invoice_validations add column if not exists human_rejected boolean;
alter table invoice_validations add column if not exists rejected_by text;

-- These were already computed and returned in the API response (used by
-- the Stage 3/4 validation UI), but never actually persisted — a reload
-- without re-running validation silently lost them, which for
-- drive_check_configured in particular meant a broken Drive integration
-- could read back as "not checked" defaulting to a false pass instead of
-- the explicit "not configured" warning.
alter table invoice_validations add column if not exists contract_file_url text;
alter table invoice_validations add column if not exists drive_file_url text;
alter table invoice_validations add column if not exists drive_folder_url text;
alter table invoice_validations add column if not exists drive_check_configured boolean;
