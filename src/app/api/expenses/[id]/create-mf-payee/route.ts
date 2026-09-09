// POST /api/expenses/[id]/create-mf-payee
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import {
  createOrReusePayeeForMember,
  MemberNotFoundError,
  NeedsBankDetailsError,
  type BankDetailsInput,
} from "@/lib/services/real/mfPayee";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const claim = await getExpenseService().getClaim(params.id);
  if (!claim) {
    return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
  }

  let bankDetails: BankDetailsInput | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object" && "bankDetails" in body) {
      bankDetails = (body as { bankDetails: BankDetailsInput }).bankDetails;
    }
  } catch {
    // no body — fine, we'll rely on the member's saved bank details (if any)
  }

  try {
    const result = await createOrReusePayeeForMember(claim.submittedBy, bankDetails, claim.submittedByEmail);

    const updated = {
      ...claim,
      mfPayeeId: result.payeeId,
      mfCounterpartyId: result.counterpartyId,
      mfPayeeCreatedAt: result.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await getExpenseService().saveClaim(updated);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof MemberNotFoundError) {
      return NextResponse.json({ error: err.message, code: "MEMBER_NOT_FOUND" }, { status: 422 });
    }
    if (err instanceof NeedsBankDetailsError) {
      return NextResponse.json(
        { error: err.message, code: "NEEDS_BANK_DETAILS", memberName: err.memberName },
        { status: 422 }
      );
    }

    const message = String(err);
    if (message.includes("MF_PAYABLES_ACCESS_TOKEN not set") || message.includes("401")) {
      return NextResponse.json(
        {
          error: "Money Forward Payables not connected",
          action: "Visit /api/auth/moneyforward-payables to authorize the app",
        },
        { status: 401 }
      );
    }

    console.error("[POST /api/expenses/[id]/create-mf-payee]", err);
    return NextResponse.json(
      { error: "Failed to create payee in Money Forward", detail: message },
      { status: 500 }
    );
  }
}
