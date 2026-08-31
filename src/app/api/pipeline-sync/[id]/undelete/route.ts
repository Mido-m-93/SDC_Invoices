import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { restoreDeletedRecord } from "@/lib/services/pipelineSyncService";

export const dynamic = "force-dynamic";

// Distinct from /[id]/restore (which un-rejects a record) — this undoes a
// soft-delete instead.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const record = await restoreDeletedRecord(params.id, user.email);
    return NextResponse.json({ success: true, record });
  } catch (err) {
    console.error("[API ERROR]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
