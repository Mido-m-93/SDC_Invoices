import { NextRequest, NextResponse } from "next/server";
import { getOutboundService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { OutboundInvoice } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  try {
    const invoices = await getOutboundService().listOutbound({ status });
    // Auto-mark overdue
    const today = new Date().toISOString().slice(0, 10);
    const enriched = invoices.map((inv) => {
      if (inv.status === "sent" && inv.dueDate < today) return { ...inv, status: "overdue" as const };
      return inv;
    });
    return NextResponse.json({ count: enriched.length, invoices: enriched });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<OutboundInvoice>;
    const invoice: OutboundInvoice = {
      id:            body.id || generateId(),
      clientName:    body.clientName ?? "",
      clientEmail:   body.clientEmail,
      projectName:   body.projectName ?? "",
      contractId:    body.contractId,
      invoiceNumber: body.invoiceNumber,
      amount:        body.amount ?? 0,
      currency:      body.currency ?? "JPY",
      billingDate:   body.billingDate ?? new Date().toISOString().slice(0, 10),
      dueDate:       body.dueDate ?? "",
      status:        body.status ?? "draft",
      notes:         body.notes,
      driveFileId:   body.driveFileId,
      driveFileUrl:  body.driveFileUrl,
      createdAt:     body.createdAt ?? new Date().toISOString(),
    };
    await getOutboundService().saveOutbound(invoice);
    return NextResponse.json({ success: true, invoice });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
