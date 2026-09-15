import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { approveStagedBudgetRecord } from "@/lib/services/budgetSyncService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const body = (await req.json().catch(() => ({}))) as { clientId?: string };
    const result = await approveStagedBudgetRecord(params.id, body.clientId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] approve staged budget", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
