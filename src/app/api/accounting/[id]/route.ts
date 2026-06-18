import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { AccountingEntry } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<AccountingEntry>;
    const entry = { ...body, id: params.id, updatedAt: new Date().toISOString() } as AccountingEntry;
    await getAccountingService().saveEntry(entry);
    return NextResponse.json({ success: true, entry });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getAccountingService().deleteEntry(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
