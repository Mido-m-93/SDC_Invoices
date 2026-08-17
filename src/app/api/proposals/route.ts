
import { NextRequest, NextResponse } from "next/server";
import { getProposalService, getLeadService } from "@/lib/services";
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
    if (!body.leadId) {
      return NextResponse.json({ error: "leadId is required — a proposal must be raised from a pipeline lead" }, { status: 400 });
    }
    const lead = await getLeadService().getLead(body.leadId);
    if (!lead) {
      return NextResponse.json({ error: `Lead ${body.leadId} not found` }, { status: 400 });
    }

    const now = new Date().toISOString();
    const proposal: Proposal = {
      id: generateId("prop"),
      clientId: body.clientId ?? "",
      clientName: body.clientName,
      leadId: body.leadId,
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

    // Link the lead forward to this proposal, matching the existing Lead.proposalId convention
    if (!lead.proposalId) {
      await getLeadService().saveLead({ ...lead, proposalId: proposal.id, updatedAt: now });
    }
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
