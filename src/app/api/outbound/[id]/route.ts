import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { OutboundInvoice } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireAuth();
  if (response) return response;
  try {
    const invoice = await getOutboundInvoiceService().getInvoice(params.id);
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ invoice });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireAuth();
  if (response) return response;
  try {
    const svc = getOutboundInvoiceService();
    const existing = await svc.getInvoice(params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json() as Partial<OutboundInvoice>;
    const updated: OutboundInvoice = { ...existing, ...body, id: params.id, updatedAt: new Date().toISOString() };
    await svc.saveInvoice(updated);
    return NextResponse.json({ success: true, invoice: updated });
  } catch (err) {
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireAuth();
  if (response) return response;
  try {
    await getOutboundInvoiceService().deleteInvoice(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
