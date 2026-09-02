// GET /api/invoices/debug-excel — shows raw closingMonth values from Excel
import { NextResponse } from "next/server";
import { getSheetsService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const rows = await getSheetsService().loadSubmissions("_all");
    const summary = rows.map((r) => ({
      row: r.submissionRowNumber,
      payerName: r.payerName,
      closingMonthRaw: r.closingMonth,
      parsedMonth: parseSnapshotMonth(r.closingMonth),
      submittedAt: r.submittedAt,
    }));
    return NextResponse.json({ totalRows: rows.length, rows: summary });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
