// POST /api/budgets/sync
// Read-only scan of the SharePoint 30_WorkTogether folder for budget-looking
// files. No extraction, no database writes, no client matching — this is
// purely "sync (rescan) and show what's there", same pattern as
// /api/contracts/member-folders.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const { listSharePointBudgetFiles } = await import("@/lib/services/real/budgetSharePointSource");
    const files = await listSharePointBudgetFiles();
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[budgets/sync] SharePoint scan failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
