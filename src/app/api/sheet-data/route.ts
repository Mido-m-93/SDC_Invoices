// GET /api/sheet-data — list the synced worksheets (names, headers, row counts).
// Admins, plus Members an admin has explicitly granted the "Sheet Data" tab.
import "server-only";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth-guard";
import { listSyncedSheets } from "@/lib/services/real/SupabaseSheetSyncStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireTabAccess("/sheet-data");
  if (!user) return response!;
  try {
    return NextResponse.json({ sheets: await listSyncedSheets() });
  } catch (err) {
    console.error("[GET /api/sheet-data]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
