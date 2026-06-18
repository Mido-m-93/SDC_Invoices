import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService } from "@/lib/services";
import type { OutboundInvoiceStatus } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const inv = await getOutboundInvoiceService().getInvoice(params.id);
    if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ invoice: inv });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const svc = getOutboundInvoiceService();
    const existing = await svc.getInvoice(params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await svc.saveInvoice({ ...existing, ...body, id: params.id, updatedAt: new Date().toISOString() } as typeof existing);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { status: OutboundInvoiceStatus; actorName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    await getOutboundInvoiceService().updateStatus(params.id, body.status, body.actorName ?? "system");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getOutboundInvoiceService().deleteInvoice(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
