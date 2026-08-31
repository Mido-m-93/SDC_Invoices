import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { deleteStagedRecord } from "@/lib/services/pipelineSyncService";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await deleteStagedRecord(params.id, user.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
