// GET /api/auth/moneyforward-payables/status - diagnostic: confirms the stored
// token can actually call the live API (GET /offices), not just that it exists.
import { NextRequest, NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const service = new MoneyForwardPayablesService();
    const offices = await service.listOffices();
    const invoiceReports = await service.listInvoiceReports();
    const exItems = await service.listExItems();
    const transactionItems = await service.listInvoiceReportTransactionItems();

    const optionsFor = req.nextUrl.searchParams.get("optionsFor");
    const options = optionsFor ? await service.listTransactionItemOptions(optionsFor) : undefined;

    const findCounterpartyName = req.nextUrl.searchParams.get("counterpartyName");
    let counterparties: Array<{ id: string; name: string; code: string }> | undefined;
    let payees: unknown[] | undefined;
    if (findCounterpartyName) {
      counterparties = await service.listCounterparties();
      const match = counterparties.find((c) => c.name.includes(findCounterpartyName));
      if (match) payees = await service.listPayees(match.id);
    }

    return NextResponse.json({
      connected: true, offices, invoiceReports, exItems, transactionItems, options, counterparties, payees,
    });
  } catch (err) {
    return NextResponse.json({ connected: false, error: String(err) }, { status: 200 });
  }
}
