import { NextRequest, NextResponse } from "next/server";
import { getCloseChecklistService } from "@/lib/services";
import type { CloseChecklistItemStatus } from "@/types";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { status?: CloseChecklistItemStatus; assignee?: string; completedBy?: string; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    await getCloseChecklistService().updateItem(params.id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
      ...(body.completedBy !== undefined ? { completedBy: body.completedBy } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
