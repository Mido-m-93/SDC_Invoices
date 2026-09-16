-- AI verification checkpoint for the quote/price sheet added in 040:
-- proposals.quote_sheet_amount (manually entered, from the quote sheet doc)
-- gets AI-compared against proposals.estimated_amount, same pattern as the
-- existing contract<->proposal / contract<->budget checks.

alter table proposals add column if not exists quote_sheet_amount numeric;
alter table proposals add column if not exists verification_quote_sheet jsonb;
