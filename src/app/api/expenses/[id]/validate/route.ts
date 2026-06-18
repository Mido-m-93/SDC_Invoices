import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const result = await svc.validateClaim(claim);
    // Persist extracted fields back to claim
    if (result.extractedAmount !== null || result.extractedDate || result.extractedVendor) {
      await svc.saveClaim({
        ...claim,
        extractedAmount: result.extractedAmount,
        extractedDate: result.extractedDate,
        extractedVendor: result.extractedVendor,
        policyViolations: result.policyViolations,
        updatedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
