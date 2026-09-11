import { NextRequest, NextResponse } from "next/server";
import { getBudgetService, getProposalService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: Budget ↔ Proposal. Compares the budget against the proposal
// it was raised from and flags anything that doesn't line up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const budgetSvc = getBudgetService();
    const budget = await budgetSvc.listBudgets().then(bs => bs.find(b => b.id === params.id));
    if (!budget) return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    if (!budget.proposalId) return NextResponse.json({ error: "Budget has no linked proposal to verify against" }, { status: 400 });

    const proposal = await getProposalService().listProposals().then(ps => ps.find(p => p.id === budget.proposalId));
    if (!proposal) return NextResponse.json({ error: `Proposal ${budget.proposalId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("budget", budget, "proposal", proposal);
    const updated = { ...budget, verificationProposal: verdict };
    await budgetSvc.saveBudget(updated);

    return NextResponse.json({ success: true, verdict, budget: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify budget", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
