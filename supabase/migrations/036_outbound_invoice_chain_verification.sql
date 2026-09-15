-- Outbound invoices now verify against Proposal and Budget too, not just
-- Contract (per the agreed Proposal -> Budget -> Contract -> Invoice -> Cash
-- chain design). Splits the single "verification" column (previously
-- Invoice vs Contract) into three. Ships together with the code that
-- reads/writes the new column names — do not run ahead of that deploy.

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'outbound_invoices' and column_name = 'verification') then
    alter table outbound_invoices rename column verification to verification_contract;
  end if;
end $$;
alter table outbound_invoices add column if not exists verification_proposal jsonb;
alter table outbound_invoices add column if not exists verification_budget jsonb;
