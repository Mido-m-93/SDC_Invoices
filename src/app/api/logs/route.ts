export const dynamic = "force-dynamic";

// src/app/api/logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export const dynamic = 'force-dynamic';

/**
 * GET /api/logs?runId=xxx
 * Returns processing logs for the specified run.
 */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json(
      { error: "Missing 'runId' parameter" },
      { status: 400 }
    );
  }

  try {
    const svc = getStorageService();
    const logs = await svc.loadLogs(runId);
    return NextResponse.json({ runId, count: logs.length, logs });
  } catch (err) {
    console.error("[GET /api/logs]", err);
    return NextResponse.json(
      { error: "Failed to load logs", detail: String(err) },
      { status: 500 }
    );
  }
}
