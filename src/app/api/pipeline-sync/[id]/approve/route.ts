import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { approveStagedRecord } from "@/lib/services/pipelineSyncService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = (await req.json().catch(() => ({}))) as { overrideClientId?: string };
    const record = await approveStagedRecord(params.id, user.email, body.overrideClientId);
    return NextResponse.json({ success: true, record });
  } catch (err) {
    console.error("[API ERROR]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
