// POST /api/auth/moneyforward-payables/test-payee
// Creates one clearly-marked test counterparty + bank account + payee inside
// Cloud Payables itself, then reads the payee back to surface its real
// invoice_transaction_default_value.cr_item_id — the value the account
// picked automatically, which has no other discovery endpoint.
import { NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = 'force-dynamic';

export async function POST() {
  const service = new MoneyForwardPayablesService();

  try {
    const result = await service.createPayeeWithBankAccount({
      counterpartyName: "TEST_DO_NOT_USE",
      payeeName: "TEST_DO_NOT_USE",
      payeeCode: "apitest1",
      bankAccount: {
        accountType: "ordinary",
        bankCode: "0001",       // みずほ銀行 (Mizuho) — real bank code
        bankBranchCode: "001",  // 本店営業部 (head office branch) — real branch code
        accountNumber: "1234567",
        holderName: "TEST DO NOT USE",
        holderNameKana: "ﾃｽﾄ ﾄﾞｳﾉｯﾄﾕｰｽ",
      },
    });

    const payee = await service.getPayee(result.counterpartyId, result.payeeId);

    return NextResponse.json({ ok: true, result, payee });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}
