-- SUPERSEDED — this file originally contained a conflicting CREATE TABLE for
-- outbound_invoices that used a different schema than migration 002.
-- The authoritative schema is in 002_phase9_outbound_invoices.sql (column: total).
-- Additional columns (drive_file_id, drive_file_url) are added by
-- 004_phase9_outbound_invoices_drive.sql via ALTER TABLE.
--
-- This file is intentionally left as a no-op to preserve migration history.
select 1;
