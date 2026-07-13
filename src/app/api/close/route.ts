export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getCloseService } from "@/lib/services";
import type { CloseChecklistItem } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  try {
    const svc = getCloseService();
    const result = await svc.getChecklist(month);
    return NextResponse.json({ month, checklist: result.items, bankSync: null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<CloseChecklistItem> & { id: string };
    if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const svc   = getCloseService();
    const month = body.month ?? new Date().toISOString().slice(0, 7);
    const list  = await svc.getChecklist(month);
    const item  = list.items.find((i) => i.id === body.id);
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    await svc.updateItem(body.id, {
      status:      body.status      ?? item.status,
      completedBy: body.completedBy ?? item.completedBy,
      completedAt: body.completedAt ?? item.completedAt,
      notes:       body.notes       ?? item.notes,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
