import { NextRequest, NextResponse } from "next/server";
import { getLeadService } from "@/lib/services";
import type { LeadStage } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { stage, actorName } = await req.json() as { stage: LeadStage; actorName: string };
    await getLeadService().updateStage(params.id, stage, actorName ?? "system");
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
