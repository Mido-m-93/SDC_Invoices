// GET  /api/bills  — form options (counterparties, open invoice reports, expense items)
// POST /api/bills  — creates a vendor bill as an MF Payables invoice_transaction
import { NextRequest, NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const service = new MoneyForwardPayablesService();
    const [counterparties, invoiceReports, exItems] = await Promise.all([
      service.listCounterparties(),
      service.listInvoiceReports(),
      service.listExItems(),
    ]);
    return NextResponse.json({ counterparties, invoiceReports, exItems });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface CreateBillBody {
  counterpartyId: string;
  payeeId: string;
  invoiceReportId: string;
  exItemId: string;
  name: string;
  totalValue: number;
  dealDate: string;
}

export async function POST(req: NextRequest) {
  let body: CreateBillBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { counterpartyId, payeeId, invoiceReportId, exItemId, name, totalValue, dealDate } = body;
  if (!counterpartyId || !payeeId || !invoiceReportId || !exItemId || !name || !totalValue || !dealDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const service = new MoneyForwardPayablesService();

    // cr_item_id (the accounts-payable credit item) has no direct picker in this API —
    // it's read back from the selected payee's own configured default, same discovery
    // path used by the test-payee/test-transaction smoke tests.
    const payee = await service.getPayee(counterpartyId, payeeId) as {
      invoice_transaction_default_value?: { cr_item_id?: string };
    };
    const crItemId = payee.invoice_transaction_default_value?.cr_item_id;
    if (!crItemId) {
      return NextResponse.json(
        { error: "Selected payee has no default accounts-payable item (cr_item_id) configured in MF Payables" },
        { status: 422 }
      );
    }

    const transaction = await service.createInvoiceTransaction(invoiceReportId, {
      name,
      exItemId,
      crItemId,
      totalValue,
      dealDate,
    });

    return NextResponse.json({ ok: true, transaction });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
