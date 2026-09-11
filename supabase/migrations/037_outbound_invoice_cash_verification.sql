-- Final stage of the Proposal -> Budget -> Contract -> Invoice -> Cash chain:
-- Invoice vs actual cash received (PaymentRecord). Purely additive — no
-- rename, safe to run any time.

alter table outbound_invoices add column if not exists verification_cash jsonb;
