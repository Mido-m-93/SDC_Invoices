// GET /api/bills/payees?counterpartyId=... — payees for the "Add Bill" form's cascading select
import { NextRequest, NextResponse } from "next/server";
import { MoneyForwardPayablesService } from "@/lib/services/real/MoneyForwardPayablesService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const counterpartyId = req.nextUrl.searchParams.get("counterpartyId");
  if (!counterpartyId) {
    return NextResponse.json({ error: "counterpartyId query param is required" }, { status: 400 });
  }

  try {
    const service = new MoneyForwardPayablesService();
    const payees = await service.listPayees(counterpartyId);
    return NextResponse.json({ payees });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
