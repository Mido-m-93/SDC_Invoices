import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getAuditLog } from "@/lib/services/pipelineSyncService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const recordId = searchParams.get("recordId") ?? undefined;
    const entries = await getAuditLog(recordId);
    return NextResponse.json({ count: entries.length, entries });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
