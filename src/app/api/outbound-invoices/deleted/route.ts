import { NextResponse } from "next/server";
import { getOutboundInvoiceService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const invoices = await getOutboundInvoiceService().listDeletedInvoices();
    return NextResponse.json({ invoices });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
