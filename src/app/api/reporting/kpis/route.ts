import { NextRequest, NextResponse } from "next/server";
import { getReportingService } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const kpis = await getReportingService().getKPIs(month);
    return NextResponse.json(kpis);
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
