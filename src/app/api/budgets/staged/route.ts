// GET /api/budgets/staged — list budgets from SharePoint sync that need
// a human to pick the client before they can be saved (see budgets/sync).
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { listStagedBudgetRecords } from "@/lib/services/budgetSyncService";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const records = await listStagedBudgetRecords("needs_review");
  return NextResponse.json({ records });
}
