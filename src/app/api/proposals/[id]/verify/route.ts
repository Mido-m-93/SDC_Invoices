import { NextRequest, NextResponse } from "next/server";
import { getProposalService, getLeadService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: Proposal ↔ Lead. Compares the proposal against the pipeline
// lead it was raised from and flags anything that doesn't line up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const proposalSvc = getProposalService();
    const proposal = await proposalSvc.listProposals().then(ps => ps.find(p => p.id === params.id));
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (!proposal.leadId) return NextResponse.json({ error: "Proposal has no linked lead to verify against" }, { status: 400 });

    const lead = await getLeadService().getLead(proposal.leadId);
    if (!lead) return NextResponse.json({ error: `Lead ${proposal.leadId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("proposal", proposal, "pipeline lead", lead);
    const updated = { ...proposal, verification: verdict };
    await proposalSvc.saveProposal(updated);

    return NextResponse.json({ success: true, verdict, proposal: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify proposal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
