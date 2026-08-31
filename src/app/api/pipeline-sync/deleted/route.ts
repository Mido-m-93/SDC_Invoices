import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { listDeletedStagedRecords } from "@/lib/services/pipelineSyncService";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const records = await listDeletedStagedRecords();
    return NextResponse.json({ records });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
