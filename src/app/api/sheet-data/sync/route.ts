// POST /api/sheet-data/sync — fetch every worksheet of the SharePoint workbook
// through Microsoft Graph and replace the stored copy. Admin-only, read-only
// against SharePoint (nothing is written back to Excel).
import "server-only";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const { fetchWorkbookSheets } = await import("@/lib/services/real/sheetSyncSource");
    const { replaceWorkbook } = await import("@/lib/services/real/SupabaseSheetSyncStore");
    const workbook = await fetchWorkbookSheets();
    const result = await replaceWorkbook(workbook);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/sheet-data/sync]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
