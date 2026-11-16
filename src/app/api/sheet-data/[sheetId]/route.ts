// GET /api/sheet-data/[sheetId] — every synced row of one worksheet.
import "server-only";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth-guard";
import { getSyncedRows } from "@/lib/services/real/SupabaseSheetSyncStore";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { sheetId: string } }) {
  const { user, response } = await requireTabAccess("/sheet-data");
  if (!user) return response!;
  if (!UUID.test(params.sheetId)) {
    return NextResponse.json({ error: "Invalid sheet id" }, { status: 400 });
  }
  try {
    return NextResponse.json({ rows: await getSyncedRows(params.sheetId) });
  } catch (err) {
    console.error("[GET /api/sheet-data/[sheetId]]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
