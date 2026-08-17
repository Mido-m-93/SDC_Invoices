// POST /api/auth/moneyforward-payables/cleanup-test-data
// Deletes what's deletable from the TEST_DO_NOT_USE counterparty created
// during write-path testing: all its bank accounts, then the counterparty
// itself. Its payee record has no DELETE endpoint in this API and is left
// behind — clearly named so it's identifiable for manual removal if needed.
import { NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = 'force-dynamic';

const TEST_COUNTERPARTY_ID = "cACoViLZ77nK4h7cvIfLfw"; // TEST_DO_NOT_USE

export async function POST() {
  const service = new MoneyForwardPayablesService();
  const steps: Record<string, unknown> = {};

  let accounts: Array<{ id: string }> = [];
  try {
    accounts = await service.listCounterpartyAccounts(TEST_COUNTERPARTY_ID);
    steps.listAccounts = { ok: true, count: accounts.length, ids: accounts.map((a) => a.id) };
  } catch (err) {
    steps.listAccounts = { ok: false, error: String(err) };
  }

  const deletedAccounts: string[] = [];
  const failedAccounts: Record<string, string> = {};
  for (const account of accounts) {
    try {
      await service.deleteCounterpartyAccount(TEST_COUNTERPARTY_ID, account.id);
      deletedAccounts.push(account.id);
    } catch (err) {
      failedAccounts[account.id] = String(err);
    }
  }
  steps.deleteAccounts = { deleted: deletedAccounts, failed: failedAccounts };

  try {
    await service.deleteCounterparty(TEST_COUNTERPARTY_ID);
    steps.deleteCounterparty = { ok: true };
  } catch (err) {
    steps.deleteCounterparty = { ok: false, error: String(err) };
  }

  return NextResponse.json({ steps });
}
