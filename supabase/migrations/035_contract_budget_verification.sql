-- Contract now verifies against both Proposal and Budget (per the agreed
-- Proposal -> Budget -> Contract -> Invoice -> Cash chain design). Splits the
-- single "verification" column (previously Contract vs Proposal) into two.
-- Ships together with the code that reads/writes the new column names —
-- do not run ahead of that deploy.

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'verification') then
    alter table contracts rename column verification to verification_proposal;
  end if;
end $$;
alter table contracts add column if not exists verification_budget jsonb;
