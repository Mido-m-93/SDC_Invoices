// src/app/api/dashboard/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDashboardService } from "@/lib/services";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter (expected YYYY-MM)" },
      { status: 400 }
    );
  }
  try {
    const stats = await getDashboardService().getStats(month);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[GET /api/dashboard/stats]", err);
    return NextResponse.json(
      { error: "Failed to load dashboard stats", detail: String(err) },
      { status: 500 }
    );
  }
}
