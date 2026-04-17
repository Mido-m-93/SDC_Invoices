// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSheetsService } from "@/lib/services";

/**
 * GET /api/invoices?month=YYYY-MM
 * Returns normalized invoice submissions for the given month.
 */
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter (expected YYYY-MM)" },
      { status: 400 }
    );
  }

  try {
    const svc = getSheetsService();
    const submissions = await svc.loadSubmissions(month);
    return NextResponse.json({ month, count: submissions.length, submissions });
  } catch (err) {
    console.error("[GET /api/invoices]", err);
    return NextResponse.json(
      { error: "Failed to load invoices", detail: String(err) },
      { status: 500 }
    );
  }
}
