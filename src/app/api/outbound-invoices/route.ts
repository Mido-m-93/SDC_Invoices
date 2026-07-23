
import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService, getContractService } from "@/lib/services";
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

  if (!body.contractId) {
    return NextResponse.json({ error: "contractId is required — a client invoice must be issued from a contract" }, { status: 400 });
  }
  const contract = await getContractService().listContracts().then(cs => cs.find(c => c.id === body.contractId));
  if (!contract) {
    return NextResponse.json({ error: `Contract ${body.contractId} not found` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const invoice: OutboundInvoice = {
    id: body.id ?? generateId(),
    contractId: contract.id,
    // Derived from the contract, not trusted from the client, so the invoice can't drift from what was agreed.
    clientId: contract.clientId ?? "",
    clientName: contract.clientName ?? "",
    projectName: contract.projectName,
    invoiceNumber: body.invoiceNumber ?? `INV-${Date.now()}`,
    billingMonth: body.billingMonth ?? now.slice(0, 7),
    issueDate: body.issueDate ?? now.slice(0, 10),
    dueDate: body.dueDate ?? "",
    subtotal: body.subtotal ?? 0,
    taxAmount: body.taxAmount ?? 0,
    total: body.total ?? 0,
    currency: contract.currency,
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
