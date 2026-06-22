import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { Contract } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const svc = getContractService();
    const contracts = await svc.listContracts();
    return NextResponse.json({ count: contracts.length, contracts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Contract>;
    const contract: Contract = {
      id: body.id || generateId(),
      vendorId: body.vendorId ?? "",
      projectName: body.projectName ?? "",
      startDate: body.startDate ?? "",
      endDate: body.endDate ?? "",
      expectedMonthlyAmount: body.expectedMonthlyAmount ?? 0,
      currency: body.currency ?? "JPY",
      paymentTerms: body.paymentTerms ?? "",
      status: body.status ?? "active",
      createdAt: body.createdAt ?? new Date().toISOString(),
    };
    await getContractService().saveContract(contract);
    return NextResponse.json({ success: true, contract });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
