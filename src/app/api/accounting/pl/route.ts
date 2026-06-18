import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const pl = await getAccountingService().getProfitAndLoss(month);
    return NextResponse.json(pl);
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
