import { NextRequest, NextResponse } from "next/server";
import { getLeadService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Lead } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Lead>;
    const lead = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Lead;
    await getLeadService().saveLead(lead);
    return NextResponse.json({ success: true, lead });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getLeadService().deleteLead(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
