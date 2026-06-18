import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { Proposal } from "@/types";

export async function GET() {
  try {
    const proposals = await getProposalService().listProposals();
    return NextResponse.json({ count: proposals.length, proposals });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Proposal>;
    const proposal: Proposal = {
      id: body.id || generateId("prop"),
      vendorId: body.vendorId ?? "",
      projectName: body.projectName ?? "",
      proposalDate: body.proposalDate ?? "",
      estimatedAmount: body.estimatedAmount ?? 0,
      currency: body.currency ?? "JPY",
      description: body.description ?? "",
      status: body.status ?? "draft",
      contractId: body.contractId,
      folderUrl: body.folderUrl,
      createdAt: body.createdAt ?? new Date().toISOString(),
    };
    await getProposalService().saveProposal(proposal);
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
