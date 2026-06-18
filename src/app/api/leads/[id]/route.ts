import { NextRequest, NextResponse } from "next/server";
import { getLeadService } from "@/lib/services";
import type { Lead } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Lead>;
    const lead = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Lead;
    await getLeadService().saveLead(lead);
    return NextResponse.json({ success: true, lead });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getLeadService().deleteLead(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
