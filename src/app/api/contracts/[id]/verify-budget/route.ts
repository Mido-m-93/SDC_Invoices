import { NextRequest, NextResponse } from "next/server";
import { getContractService, getBudgetService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: Contract ↔ Budget. Compares the contract against the budget
// it was raised from and flags anything that doesn't line up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const contractSvc = getContractService();
    const contract = await contractSvc.listContracts().then(cs => cs.find(c => c.id === params.id));
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    if (!contract.budgetId) return NextResponse.json({ error: "Contract has no linked budget to verify against" }, { status: 400 });

    const budget = await getBudgetService().listBudgets().then(bs => bs.find(b => b.id === contract.budgetId));
    if (!budget) return NextResponse.json({ error: `Budget ${contract.budgetId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("contract", contract, "budget", budget);
    const updated = { ...contract, verificationBudget: verdict };
    await contractSvc.saveContract(updated);

    return NextResponse.json({ success: true, verdict, contract: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify contract budget", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
