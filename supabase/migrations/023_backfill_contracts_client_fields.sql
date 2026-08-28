-- Backfill contracts.client_id / client_name from the linked proposal.
-- SupabaseContractService.toRow() never wrote these columns (added in migration 011)
-- until it was fixed, so every existing client contract has them blank ('').
-- Client contracts always trace back to an accepted proposal, so recover the
-- values from there rather than losing them.

update contracts
set
  client_id = proposals.client_id,
  client_name = proposals.client_name
from proposals
where contracts.proposal_id = proposals.id
  and contracts.client_id = ''
  and proposals.client_id <> '';
