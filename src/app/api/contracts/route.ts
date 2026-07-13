
import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
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
