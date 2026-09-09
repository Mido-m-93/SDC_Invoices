-- Bank account details (entered once per member, reused for every future
-- MoneyForward Payee creation) + the resulting MF Payables identifiers, so we
-- never re-create a payee/counterparty for the same person twice.
alter table members
  add column if not exists bank_account_type text,
  add column if not exists bank_code text,
  add column if not exists bank_branch_code text,
  add column if not exists bank_account_number text,
  add column if not exists bank_holder_name text,
  add column if not exists bank_holder_name_kana text,
  add column if not exists mf_counterparty_id text,
  add column if not exists mf_payee_id text,
  add column if not exists mf_payee_created_at timestamptz;

-- Surface payee status directly on the invoice validation result and expense
-- claim, matching the existing mf_billing_id/mf_billing_url/mf_sent_at pattern
-- used for the (separate, JPY-only Invoice product) "Send to Money Forward" flow.
alter table invoice_validations
  add column if not exists mf_payee_id text,
  add column if not exists mf_counterparty_id text,
  add column if not exists mf_payee_created_at timestamptz;

alter table expense_claims
  add column if not exists mf_payee_id text,
  add column if not exists mf_counterparty_id text,
  add column if not exists mf_payee_created_at timestamptz;
