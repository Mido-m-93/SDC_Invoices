import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Proposal } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Proposal>;
    const proposal = { ...body, id: params.id } as Proposal;
    await getProposalService().saveProposal(proposal);
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getProposalService().deleteProposal(params.id, user.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
