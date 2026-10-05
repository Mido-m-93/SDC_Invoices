// POST /api/expenses/[id]/mark-paid — marks an approved, saved claim as paid.
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: { actorName?: string };
  try { body = await req.json(); } catch { body = {}; }

  try {
    const svc = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (claim.status !== "approved") {
      return NextResponse.json({ error: "Only approved claims can be marked paid" }, { status: 422 });
    }
    if (!claim.filedStoragePath) {
      return NextResponse.json({ error: "Save the receipt before marking it paid" }, { status: 422 });
    }

    await svc.updateStatus(params.id, "paid", body.actorName ?? "system");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/mark-paid]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
