
import { NextRequest, NextResponse } from "next/server";
import { getContractService, getProposalService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Contract } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const svc = getContractService();
    const contracts = await svc.listContracts();
    return NextResponse.json({ count: contracts.length, contracts });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Contract>;

    // Client-side contracts must trace back to an accepted proposal (pipeline: Proposal → Contract).
    // Vendor-only contracts (no clientId) are unaffected — they never went through the Proposal pipeline.
    if (body.clientId) {
      if (!body.proposalId) {
        return NextResponse.json({ error: "proposalId is required for client contracts — this contract must come from an accepted proposal" }, { status: 400 });
      }
      const proposal = await getProposalService().listProposals().then(ps => ps.find(p => p.id === body.proposalId));
      if (!proposal) {
        return NextResponse.json({ error: `Proposal ${body.proposalId} not found` }, { status: 400 });
      }
      if (proposal.status !== "accepted") {
        return NextResponse.json({ error: `Proposal ${body.proposalId} is not accepted yet (status: ${proposal.status})` }, { status: 400 });
      }
    }

    const contract: Contract = {
      id: body.id || generateId("con"),
      vendorId: body.vendorId ?? "",
      clientId: body.clientId || undefined,
      clientName: body.clientName || undefined,
      projectName: body.projectName ?? "",
      startDate: body.startDate ?? "",
      endDate: body.endDate ?? "",
      expectedMonthlyAmount: body.expectedMonthlyAmount ?? 0,
      currency: body.currency ?? "JPY",
      paymentTerms: body.paymentTerms ?? "",
      status: body.status ?? "active",
      proposalId: body.proposalId || undefined,
      contractFolderUrl: body.contractFolderUrl || undefined,
      createdAt: body.createdAt ?? new Date().toISOString(),
    };
    await getContractService().saveContract(contract);
    return NextResponse.json({ success: true, contract });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
