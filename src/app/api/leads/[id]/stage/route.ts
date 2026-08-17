import { NextRequest, NextResponse } from "next/server";
import { getLeadService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { LeadStage } from "@/types";

export const dynamic = 'force-dynamic';

const VALID_STAGES = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost", "on_hold"];

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as { stage: LeadStage };
    if (!VALID_STAGES.includes(body.stage)) {
      return NextResponse.json({ error: "Invalid stage value" }, { status: 400 });
    }
    await getLeadService().updateStage(params.id, body.stage, user.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
