import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

// Per-row soft delete — distinct from DELETE /api/invoices, which hard-wipes
// an entire month's submissions and is unrelated to this Archives flow.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getStorageService().deleteSubmission(params.id, user.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
