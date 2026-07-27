import { NextRequest, NextResponse } from "next/server";
import { getProposalService, getContractService, getLeadService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { ConsistencyVerdict } from "@/types";

export const dynamic = 'force-dynamic';

async function tryVerify(labelA: string, a: unknown, labelB: string, b: unknown): Promise<ConsistencyVerdict | undefined> {
  try {
    return await verifyConsistency(labelA, a, labelB, b);
  } catch (err) {
    console.warn(`[verify] ${labelA} vs ${labelB} check failed, proceeding without it:`, err);
    return undefined;
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const proposalSvc = getProposalService();
    const contractSvc = getContractService();
    const leadSvc = getLeadService();
    const { override } = await req.json().catch(() => ({ override: false })) as { override?: boolean };

    const proposals = await proposalSvc.listProposals();
    const proposal = proposals.find(p => p.id === params.id);
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status === "accepted") {
      return NextResponse.json({ error: "Proposal is already accepted" }, { status: 400 });
    }

    // AI checkpoint: Proposal ↔ Lead — don't accept a proposal that contradicts its source lead
    // without the user explicitly overriding.
    let proposalVerdict: ConsistencyVerdict | undefined;
    if (proposal.leadId) {
      const lead = await leadSvc.getLead(proposal.leadId);
      if (lead) {
        proposalVerdict = await tryVerify("proposal", proposal, "pipeline lead", lead);
        if (proposalVerdict && !proposalVerdict.consistent && !override) {
          return NextResponse.json({
            error: "Proposal is inconsistent with its pipeline lead",
            discrepancies: proposalVerdict.discrepancies,
            requiresOverride: true,
          }, { status: 409 });
        }
      }
    }

    // 1. Create a contract pre-filled from the proposal
    const contractId = generateId("con");
    const now = new Date().toISOString();
    const contract = {
      id: contractId,
      vendorId: "",
      clientId: proposal.clientId || undefined,
      clientName: proposal.clientName || undefined,
      projectName: proposal.projectName,
      startDate: now.slice(0, 10),
      endDate: now.slice(0, 10),   // placeholder — user fills in Contracts page
      expectedMonthlyAmount: 0,
      currency: proposal.currency,
      paymentTerms: "",
      status: "active" as const,
      proposalId: proposal.id,
      contractFolderUrl: undefined,
      createdAt: now,
      verification: undefined as ConsistencyVerdict | undefined,
    };

    // AI checkpoint: Contract ↔ Proposal
    contract.verification = await tryVerify("contract", contract, "proposal", proposal);

    try {
      await contractSvc.saveContract(contract);
    } catch (contractErr) {
      const msg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      throw new Error(`saveContract failed: ${msg}`);
    }

    // 2. Mark proposal as accepted and link the contract
    const updatedProposal = { ...proposal, status: "accepted" as const, contractId, verification: proposalVerdict ?? proposal.verification };
    await proposalSvc.saveProposal(updatedProposal);

    // 3. Advance any linked leads to "won"
    const leads = await leadSvc.listLeads();
    const linkedLeads = leads.filter(l => l.proposalId === proposal.id);
    await Promise.all(
      linkedLeads.map(l =>
        leadSvc.saveLead({
          ...l,
          stage: "won",
          probability: 100,
          updatedAt: now,
        })
      )
    );

    return NextResponse.json({
      success: true,
      proposal: updatedProposal,
      contract,
      leadsAdvanced: linkedLeads.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] accept proposal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
