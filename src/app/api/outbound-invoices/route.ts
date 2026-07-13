
import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { OutboundInvoice, OutboundInvoiceStatus } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as OutboundInvoiceStatus | null;
  const billingMonth = searchParams.get("billingMonth") ?? undefined;
  try {
    const invoices = await getOutboundInvoiceService().listInvoices({ status: status ?? undefined, billingMonth });
    const summary = await getOutboundInvoiceService().getSummary(billingMonth);
    return NextResponse.json({ invoices, summary });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<OutboundInvoice>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = new Date().toISOString();
  const invoice: OutboundInvoice = {
    id: body.id ?? generateId(),
    contractId: body.contractId ?? "",
    clientId: body.clientId ?? "",
    clientName: body.clientName ?? "",
    projectName: body.projectName ?? "",
    invoiceNumber: body.invoiceNumber ?? `INV-${Date.now()}`,
    billingMonth: body.billingMonth ?? now.slice(0, 7),
    issueDate: body.issueDate ?? now.slice(0, 10),
    dueDate: body.dueDate ?? "",
    subtotal: body.subtotal ?? 0,
    taxAmount: body.taxAmount ?? 0,
    total: body.total ?? 0,
    currency: body.currency ?? "JPY",
    status: body.status ?? "draft",
    notes: body.notes ?? "",
    sentAt: body.sentAt ?? null,
    paidAt: body.paidAt ?? null,
    paidAmount: body.paidAmount ?? null,
    createdBy: body.createdBy ?? "",
    approvedBy: body.approvedBy ?? "",
    approvedAt: body.approvedAt ?? null,
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  try {
    await getOutboundInvoiceService().saveInvoice(invoice);
    return NextResponse.json({ invoice });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
