import { NextRequest, NextResponse } from "next/server";
import { getCloseService } from "@/lib/services";
import type { MonthlyChecklistItem } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  try {
    const svc         = getCloseService();
    const [checklist, bankSync] = await Promise.all([
      svc.getChecklist(month),
      svc.getBankSyncStatus(),
    ]);
    return NextResponse.json({ month, checklist, bankSync });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<MonthlyChecklistItem> & { id: string };
    if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const svc  = getCloseService();
    const month = body.month ?? new Date().toISOString().slice(0, 7);
    const list  = await svc.getChecklist(month);
    const item  = list.find((i) => i.id === body.id);
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const updated: MonthlyChecklistItem = {
      ...item,
      status:      body.status ?? item.status,
      completedBy: body.completedBy ?? item.completedBy,
      completedAt: body.completedAt ?? item.completedAt,
      notes:       body.notes ?? item.notes,
    };
    await svc.saveChecklistItem(updated);
    return NextResponse.json({ success: true, item: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
