import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";
import type { AccountingEntry } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<AccountingEntry>;
    const entry = { ...body, id: params.id, updatedAt: new Date().toISOString() } as AccountingEntry;
    await getAccountingService().saveEntry(entry);
    return NextResponse.json({ success: true, entry });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getAccountingService().deleteEntry(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
