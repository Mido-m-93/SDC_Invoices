import { NextRequest, NextResponse } from "next/server";
import { getProposalService, getContractService, getLeadService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const proposalSvc = getProposalService();
    const contractSvc = getContractService();
    const leadSvc = getLeadService();

    const proposals = await proposalSvc.listProposals();
    const proposal = proposals.find(p => p.id === params.id);
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status === "accepted") {
      return NextResponse.json({ error: "Proposal is already accepted" }, { status: 400 });
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
    };
    try {
      await contractSvc.saveContract(contract);
    } catch (contractErr) {
      const msg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      throw new Error(`saveContract failed: ${msg}`);
    }

    // 2. Mark proposal as accepted and link the contract
    const updatedProposal = { ...proposal, status: "accepted" as const, contractId };
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
