// POST /api/invoices/create-mf-payee
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import {
  createOrReusePayeeForMember,
  MemberNotFoundError,
  NeedsBankDetailsError,
  type BankDetailsInput,
} from "@/lib/services/real/mfPayee";
import type { InvoiceSubmission, InvoiceValidationResult } from "@/types";

export const dynamic = "force-dynamic";

interface RequestBody {
  submission: InvoiceSubmission;
  validation: InvoiceValidationResult;
  bankDetails?: BankDetailsInput;
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submission, validation, bankDetails } = body as Partial<RequestBody>;
  if (!submission || !validation) {
    return NextResponse.json(
      { error: "Provide 'submission' and 'validation' in body" },
      { status: 400 }
    );
  }

  if (!submission.payerName) {
    return NextResponse.json(
      {
        error: "This submission has no name, so we can't match it to a registered member.",
        code: "NO_NAME",
      },
      { status: 422 }
    );
  }

  try {
    const result = await createOrReusePayeeForMember(submission.payerName, bankDetails, submission.email);

    try {
      const storage = getStorageService();
      const [existing] = await storage.loadValidationResults([submission.id]);
      if (existing) {
        await storage.saveValidationResult({
          ...existing,
          mfPayeeId: result.payeeId,
          mfCounterpartyId: result.counterpartyId,
          mfPayeeCreatedAt: result.createdAt,
        });
      }
    } catch (storeErr) {
      console.warn("[create-mf-payee] Could not store payee info on validation result:", storeErr);
    }

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

    console.error("[POST /api/invoices/create-mf-payee]", err);
    return NextResponse.json(
      { error: "Failed to create payee in Money Forward", detail: message },
      { status: 500 }
    );
  }
}
