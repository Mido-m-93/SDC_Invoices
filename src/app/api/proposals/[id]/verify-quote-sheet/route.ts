import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: Quote/Price Sheet ↔ Proposal. Compares the amount recorded
// from the quote/price sheet against this proposal's estimatedAmount.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const proposalSvc = getProposalService();
    const proposal = await proposalSvc.listProposals().then(ps => ps.find(p => p.id === params.id));
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.quoteSheetAmount == null) {
      return NextResponse.json({ error: "Proposal has no quote sheet amount to verify against" }, { status: 400 });
    }

    const quoteSheet = {
      amount: proposal.quoteSheetAmount,
      currency: proposal.currency,
      url: proposal.quoteSheetUrl ?? null,
    };
    const verdict = await verifyConsistency("quote/price sheet", quoteSheet, "proposal", proposal);
    const updated = { ...proposal, verificationQuoteSheet: verdict };
    await proposalSvc.saveProposal(updated);

    return NextResponse.json({ success: true, verdict, proposal: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify proposal quote sheet", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
