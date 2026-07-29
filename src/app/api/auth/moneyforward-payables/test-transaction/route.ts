// POST /api/auth/moneyforward-payables/test-transaction
// One-shot smoke test: creates a single ¥1 test transaction inside the real
// existing draft invoice_report, confirms the response, then deletes it
// immediately — proves the write path works without leaving residue.
import { NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = 'force-dynamic';

const DRAFT_INVOICE_REPORT_ID = "zVqRnlxckHjfWv0zq_1QDw"; // "2026年04月支払依頼" (unsubmitted)
const EX_ITEM_ID = "2kZEehoQlT5ykabIPHp-nQ"; // 旅費交通費
const CR_ITEM_ID = "Jzzn1Jgl88YbK5Eq1o9kog";  // 旅費交通費 (linked chart-of-accounts item)

export async function POST() {
  const service = new MoneyForwardPayablesService();
  const steps: Record<string, unknown> = {};

  let created: Record<string, unknown> | null = null;
  try {
    created = await service.createInvoiceTransaction(DRAFT_INVOICE_REPORT_ID, {
      name: "TEST_DO_NOT_USE (API connectivity test — safe to ignore/delete)",
      exItemId: EX_ITEM_ID,
      crItemId: CR_ITEM_ID,
      totalValue: 1,
      dealDate: new Date().toISOString().slice(0, 10),
    });
    steps.create = { ok: true, transaction: created };
  } catch (err) {
    steps.create = { ok: false, error: String(err) };
    return NextResponse.json({ steps }, { status: 200 });
  }

  const transactionId = String((created as { id?: string }).id ?? "");
  try {
    await service.deleteInvoiceTransaction(DRAFT_INVOICE_REPORT_ID, transactionId);
    steps.delete = { ok: true };
  } catch (err) {
    steps.delete = { ok: false, error: String(err), transactionId };
  }

  return NextResponse.json({ steps });
}
