export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Proposal } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const proposals = await getProposalService().listProposals();
    return NextResponse.json({ count: proposals.length, proposals });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Proposal>;
    const now = new Date().toISOString();
    const proposal: Proposal = {
      id: generateId("prop"),
      vendorId: body.vendorId ?? "",
      projectName: body.projectName ?? "",
      proposalDate: body.proposalDate ?? "",
      estimatedAmount: body.estimatedAmount ?? 0,
      currency: body.currency ?? "JPY",
      description: body.description ?? "",
      status: body.status ?? "draft",
      contractId: body.contractId,
      folderUrl: body.folderUrl,
      createdAt: now,
    };
    await getProposalService().saveProposal(proposal);
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
