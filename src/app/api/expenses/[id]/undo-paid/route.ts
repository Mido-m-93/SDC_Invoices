// POST /api/expenses/[id]/undo-paid
// Reverses mark-paid: a paid claim goes back to "approved" with the paid date
// cleared. Approval and the saved receipt are kept, so it can be marked paid
// again (and shows up in the bank transfer export again).

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
    if (claim.status !== "paid") {
      return NextResponse.json({ error: "Only paid claims can be un-paid" }, { status: 400 });
    }

    await svc.saveClaim({
      ...claim,
      status: "approved",
      paidAt: null,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/undo-paid]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
