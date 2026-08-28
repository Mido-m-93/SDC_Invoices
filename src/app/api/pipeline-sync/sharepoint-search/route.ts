import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getGraphToken, resolveSiteId, searchDriveItems, DEFAULT_SITE_PATH } from "@/lib/services/real/graphClient";

export const dynamic = "force-dynamic";

// GET /api/pipeline-sync/sharepoint-search?q=...
// Live filename/folder-name lookup against SharePoint itself (Graph's drive
// search index — fast, no file download or AI extraction), distinct from
// the Pipeline Sync list which only searches already-synced Supabase data.
// Lets a reviewer check "does this client actually have anything in
// WorkTogether" without waiting for (or triggering) a full sync.
export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ error: "?q= must be at least 2 characters" }, { status: 400 });
  }

  const hasAzureCreds = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
  if (!hasAzureCreds) {
    return NextResponse.json({ error: "AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET not configured" }, { status: 500 });
  }

  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const results = await searchDriveItems(siteId, q, token);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[API ERROR] pipeline-sync/sharepoint-search", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
