-- Allow client-only contracts (no vendor required)
-- The original contracts table required vendor_id to be a valid vendor FK.
-- Pipeline contracts (Client→Lead→Proposal→Contract) may not have a vendor.

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_vendor_id_fkey;
ALTER TABLE contracts ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN vendor_id SET DEFAULT '';
