import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { checkMemberBySharePointContracts } from "@/lib/services/real/SharePointContractService";

export const dynamic = 'force-dynamic';

const hasAzureCreds = !!(
  process.env.AZURE_TENANT_ID &&
  process.env.AZURE_CLIENT_ID &&
  process.env.AZURE_CLIENT_SECRET
);

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc   = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Step 1: SharePoint member check — is the submitter a registered member?
    let memberRegistered = true; // optimistic default when creds not configured
    if (hasAzureCreds && claim.submittedBy) {
      try {
        const spResult = await checkMemberBySharePointContracts(claim.submittedBy);
        memberRegistered = spResult.matched;
      } catch (err) {
        console.warn("[expense validate] SP check failed — skipping:", err);
      }
    }

    // Step 2: Policy violation checks (receipt, amount, etc.)
    const result = await svc.validateClaim(claim);

    // Step 3: Merge SharePoint result into violations
    if (!memberRegistered) {
      if (!result.policyViolations.includes("NOT_REGISTERED_MEMBER")) {
        result.policyViolations.push("NOT_REGISTERED_MEMBER");
      }
      if (result.riskLevel === "OK") result.riskLevel = "NEEDS_REVIEW";
    }

    // Step 4: Persist violations and any extracted fields back to the claim
    await svc.saveClaim({
      ...claim,
      extractedAmount:    result.extractedAmount,
      extractedDate:      result.extractedDate,
      extractedVendor:    result.extractedVendor,
      extractedRecipient: result.extractedRecipient ?? null,
      extractedPurpose:   result.extractedPurpose ?? null,
      policyViolations:   result.policyViolations,
      updatedAt:          new Date().toISOString(),
    });

    return NextResponse.json({ result, memberRegistered });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
