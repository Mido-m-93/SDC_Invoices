import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService, getContractService } from "@/lib/services";
import type { OutboundInvoiceStatus } from "@/types";

export const dynamic = 'force-dynamic';

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

    // The contract link is set at creation and not meant to change afterward (mirrors
    // Proposal.leadId) — reject attempts to clear or repoint it to a missing contract.
    if (body.contractId && body.contractId !== existing.contractId) {
      const contract = await getContractService().listContracts().then(cs => cs.find(c => c.id === body.contractId));
      if (!contract) return NextResponse.json({ error: `Contract ${body.contractId} not found` }, { status: 400 });
    }
    const contractId = body.contractId || existing.contractId;
    if (!contractId) return NextResponse.json({ error: "contractId is required" }, { status: 400 });

    await svc.saveInvoice({ ...existing, ...body, contractId, id: params.id, updatedAt: new Date().toISOString() } as typeof existing);
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
