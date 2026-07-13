export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import { generateId } from "@/lib/utils";
import type { OutboundInvoice } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;
  void user;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const billingMonth = searchParams.get("billingMonth") ?? undefined;
  try {
    const invoices = await getOutboundInvoiceService().listInvoices({ status: status as OutboundInvoice["status"] | undefined, billingMonth });
    const today = new Date().toISOString().slice(0, 10);
    const enriched = invoices.map((inv) => {
      if (inv.status === "sent" && inv.dueDate && inv.dueDate < today) return { ...inv, status: "overdue" as const };
      return inv;
    });
    return NextResponse.json({ count: enriched.length, invoices: enriched });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load outbound invoices" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;
  try {
    const body = await req.json() as Partial<OutboundInvoice>;
    const now = new Date().toISOString();
    const invoice: OutboundInvoice = {
      id:            generateId("inv"),
      contractId:    body.contractId    ?? "",
      clientId:      body.clientId      ?? "",
      clientName:    body.clientName    ?? "",
      projectName:   body.projectName   ?? "",
      invoiceNumber: body.invoiceNumber ?? "",
      billingMonth:  body.billingMonth  ?? now.slice(0, 7),
      issueDate:     body.issueDate     ?? now.slice(0, 10),
      dueDate:       body.dueDate       ?? "",
      subtotal:      body.subtotal      ?? 0,
      taxAmount:     body.taxAmount     ?? 0,
      total:         body.total         ?? 0,
      currency:      body.currency      ?? "JPY",
      status:        body.status        ?? "draft",
      notes:         body.notes         ?? "",
      sentAt:        body.sentAt        ?? null,
      paidAt:        body.paidAt        ?? null,
      paidAmount:    body.paidAmount    ?? null,
      createdBy:     user.email,
      approvedBy:    body.approvedBy    ?? "",
      approvedAt:    body.approvedAt    ?? null,
      createdAt:     now,
      updatedAt:     now,
    };
    await getOutboundInvoiceService().saveInvoice(invoice);
    return NextResponse.json({ success: true, invoice }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create outbound invoice" }, { status: 500 });
  }
}
