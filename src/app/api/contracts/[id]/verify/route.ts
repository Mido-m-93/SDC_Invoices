import { NextRequest, NextResponse } from "next/server";
import { getContractService, getProposalService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: Contract ↔ Proposal. Compares the contract against the
// proposal it was accepted from and flags anything that doesn't line up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const contractSvc = getContractService();
    const contract = await contractSvc.listContracts().then(cs => cs.find(c => c.id === params.id));
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    if (!contract.proposalId) return NextResponse.json({ error: "Contract has no linked proposal to verify against" }, { status: 400 });

    const proposal = await getProposalService().listProposals().then(ps => ps.find(p => p.id === contract.proposalId));
    if (!proposal) return NextResponse.json({ error: `Proposal ${contract.proposalId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("contract", contract, "proposal", proposal);
    const updated = { ...contract, verification: verdict };
    await contractSvc.saveContract(updated);

    return NextResponse.json({ success: true, verdict, contract: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify contract", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
