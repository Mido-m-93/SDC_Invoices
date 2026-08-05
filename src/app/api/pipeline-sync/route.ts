import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { runPipelineSync, listStagedRecords, getSourceConnectionStatus } from "@/lib/services/pipelineSyncService";
import type { PipelineSourceType, PipelineRecordStatus } from "@/types";

export const dynamic = "force-dynamic";

const VALID_SOURCES: PipelineSourceType[] = ["notion", "sharepoint"];
const VALID_STATUSES: PipelineRecordStatus[] = ["auto_linked", "needs_review", "approved", "rejected"];

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as PipelineRecordStatus | null;
    const source = searchParams.get("source") as PipelineSourceType | null;
    const records = await listStagedRecords({
      status: status && VALID_STATUSES.includes(status) ? status : undefined,
      source: source && VALID_SOURCES.includes(source) ? source : undefined,
    });
    return NextResponse.json({ count: records.length, records, sourceStatus: getSourceConnectionStatus() });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = (await req.json()) as { source?: string };
    if (!body.source || !VALID_SOURCES.includes(body.source as PipelineSourceType)) {
      return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 });
    }
    const result = await runPipelineSync(body.source as PipelineSourceType, user.email);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[API ERROR]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
