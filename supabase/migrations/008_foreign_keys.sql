-- Phase 11 follow-up: Add FK constraints for referential integrity
-- All Phase 11 tables used plain text columns for cross-table relationships.
-- This migration adds FK constraints where the referenced table exists.

-- leads.client_id → clients.id
alter table leads
  add constraint leads_client_id_fk
  foreign key (client_id) references clients (id)
  on delete set default
  deferrable initially deferred;

-- leads.proposal_id → proposals.id (nullable)
alter table leads
  add constraint leads_proposal_id_fk
  foreign key (proposal_id) references proposals (id)
  on delete set null
  deferrable initially deferred;

-- proposals.client_id → clients.id
alter table proposals
  add constraint proposals_client_id_fk
  foreign key (client_id) references clients (id)
  on delete set default
  deferrable initially deferred;

-- accounting_entries.client_id → clients.id (allow empty string sentinel, skip FK)
-- Note: client_id, vendor_id, member_id use empty string '' as "none" sentinel,
-- so FK constraints are not added for those columns (FK requires NULL for "no value").
-- Migrate to NULL sentinel in a future schema cleanup before adding these FKs.
