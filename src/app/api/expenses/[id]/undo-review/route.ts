// POST /api/expenses/[id]/undo-review
// Reverts an approved or rejected expense claim back to "submitted",
// clearing the reviewer/approval fields so it re-enters the review queue
// as if it had never been decided on.

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
    if (claim.status !== "approved" && claim.status !== "rejected") {
      return NextResponse.json({ error: "Only approved or rejected claims can be undone" }, { status: 400 });
    }

    await svc.saveClaim({
      ...claim,
      status: "submitted",
      reviewedBy: "",
      reviewedAt: null,
      reviewerComment: "",
      approvedBy: "",
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/undo-review]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
