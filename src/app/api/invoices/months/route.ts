
import { NextResponse } from "next/server";
import { getStorageService, getSheetsService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storage = getStorageService();
    // Active months (non-deleted rows) and all-ever months (including deleted)
    const [storedMonths, allMonths] = await Promise.all([
      storage.listAvailableMonths(),
      storage.listAllMonths(),
    ]);
    // Months where all rows have been deleted — don't resurface them from Excel
    const exhaustedMonths = new Set(allMonths.filter((m) => !storedMonths.includes(m)));

    // Also scan the live Excel so genuinely new months appear in the dropdown
    // before they've ever been loaded into storage.
    let excelMonths: string[] = [];
    try {
      const rows = await getSheetsService().loadSubmissions(“_all”);
      const seen = new Set<string>();
      for (const row of rows) {
        const m = parseSnapshotMonth(row.closingMonth);
        if (m !== “unknown” && !exhaustedMonths.has(m)) seen.add(m);
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
