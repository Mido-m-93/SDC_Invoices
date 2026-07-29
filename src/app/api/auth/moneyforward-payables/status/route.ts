// GET /api/auth/moneyforward-payables/status - diagnostic: confirms the stored
// token can actually call the live API (GET /offices), not just that it exists.
import { NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const service = new MoneyForwardPayablesService();
    const offices = await service.listOffices();
    const invoiceReports = await service.listInvoiceReports();
    const exItems = await service.listExItems();
    const transactionItems = await service.listInvoiceReportTransactionItems();
    return NextResponse.json({ connected: true, offices, invoiceReports, exItems, transactionItems });
  } catch (err) {
    return NextResponse.json({ connected: false, error: String(err) }, { status: 200 });
  }
}
