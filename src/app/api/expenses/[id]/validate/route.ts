import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { checkMemberBySharePointContracts } from "@/lib/services/real/SharePointContractService";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc   = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Run receipt validation and SharePoint member check in parallel
    const [result, spResult] = await Promise.all([
      svc.validateClaim(claim),
      checkMemberBySharePointContracts(claim.submittedBy).catch(() => ({
        matched: false,
        contractFileName: null,
        contractInfo: null,
      })),
    ]);

    const fullResult = {
      ...result,
      memberMatched:    spResult.matched,
      contractFileName: spResult.contractFileName ?? null,
    };

    // Persist extracted fields back to claim
    if (
      fullResult.extractedAmount !== null ||
      fullResult.extractedDate ||
      fullResult.extractedVendor
    ) {
      await svc.saveClaim({
        ...claim,
        extractedAmount:  fullResult.extractedAmount,
        extractedDate:    fullResult.extractedDate,
        extractedVendor:  fullResult.extractedVendor,
        policyViolations: fullResult.policyViolations,
        updatedAt:        new Date().toISOString(),
      });
    }

    return NextResponse.json({
      result: fullResult,
      _debug: { receiptUrl: claim.receiptUrl ?? null },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
