import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
    }
    const pl = await getAccountingService().getProfitAndLoss(month);
    return NextResponse.json(pl);
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
