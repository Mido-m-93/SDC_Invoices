import { NextResponse } from "next/server";
import { getStorageService, getSheetsService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Months already persisted in storage
    const storedMonths = await getStorageService().listAvailableMonths();

    // Also scan the live Excel so future months (e.g. next month's submissions)
    // appear in the dropdown before they're loaded into storage.
    let excelMonths: string[] = [];
    try {
      const rows = await getSheetsService().loadSubmissions("_all");
      const seen = new Set<string>();
      for (const row of rows) {
        const m = parseSnapshotMonth(row.closingMonth);
        if (m !== "unknown") seen.add(m);
      }
      excelMonths = Array.from(seen);
    } catch {
      // Best-effort — fall back to stored months only if Excel is unreachable
    }

    const merged = Array.from(new Set([...storedMonths, ...excelMonths]))
      .sort()
      .reverse();

    return NextResponse.json({ months: merged });
  } catch (err) {
    console.error("[GET /api/invoices/months]", err);
    return NextResponse.json({ months: [] });
  }
}
