// POST /api/expenses/[id]/undo-validate
// Clears the AI-extracted fields that /validate persists onto the claim
// (extractedAmount/Date/Vendor, policyViolations), reverting it to an
// unvalidated state. Doesn't touch status/reviewer fields — that's
// undo-review's job.

import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const svc = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await svc.saveClaim({
      ...claim,
      extractedAmount: null,
      extractedDate: null,
      extractedVendor: null,
      policyViolations: [],
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/undo-validate]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
