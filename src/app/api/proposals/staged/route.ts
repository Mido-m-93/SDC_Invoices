// GET /api/proposals/staged — list proposals from SharePoint sync that need
// a human to pick the client before they can be saved (see proposals/sync).
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { listStagedProposalRecords } from "@/lib/services/proposalSyncService";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const records = await listStagedProposalRecords("needs_review");
  return NextResponse.json({ records });
}
