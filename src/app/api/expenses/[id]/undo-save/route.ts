// POST /api/expenses/[id]/undo-save
// Reverses Save: removes the saved copy of the receipt and clears the filed
// fields, so the claim goes back to "approved, not saved" and can be saved
// again. The original attachment is never touched. Refuses while the claim is
// paid (undo that first).

import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const RECEIPTS_BUCKET = "expense-receipts";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const svc = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (claim.status === "paid") {
      return NextResponse.json({ error: "Undo Paid first, then undo Save." }, { status: 409 });
    }
    if (!claim.filedStoragePath) {
      return NextResponse.json({ error: "This claim is not saved." }, { status: 409 });
    }

    // Best effort: the claim record is what matters, and a re-save overwrites
    // the same path (upsert), so a leftover object is harmless.
    try {
      const { error } = await getSupabaseClient().storage.from(RECEIPTS_BUCKET).remove([claim.filedStoragePath]);
      if (error) console.warn("[POST /api/expenses/[id]/undo-save] could not remove the stored receipt", error);
    } catch (err) {
      console.warn("[POST /api/expenses/[id]/undo-save] could not remove the stored receipt", err);
    }

    await svc.saveClaim({
      ...claim,
      filedStoragePath: null,
      filedAt: null,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/undo-save]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
