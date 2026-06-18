import { NextRequest, NextResponse } from "next/server";
import { getOutboundService } from "@/lib/services";
import type { OutboundInvoice } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc      = getOutboundService();
    const existing = await svc.getOutbound(params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body    = await req.json() as Partial<OutboundInvoice>;
    const updated = { ...existing, ...body, id: params.id };
    await svc.saveOutbound(updated);
    return NextResponse.json({ success: true, invoice: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getOutboundService().deleteOutbound(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
