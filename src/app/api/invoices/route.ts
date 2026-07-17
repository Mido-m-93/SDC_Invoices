// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSheetsService, getStorageService, getTrashService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { parseSnapshotMonth } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export const maxDuration = 25;

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter (expected YYYY-MM)" },
      { status: 400 }
    );
  }

  try {
    console.log(`[GET /api/invoices] month=${month} mock_sheets=${process.env.NEXT_PUBLIC_USE_MOCK_SHEETS} mock_storage=${process.env.NEXT_PUBLIC_USE_MOCK_STORAGE} azure_tenant=${!!process.env.AZURE_TENANT_ID}`);

    console.log("[GET /api/invoices] loading from storage...");
    const stored = await getStorageService().loadSubmissionsFromStore(month);
    console.log(`[GET /api/invoices] storage returned ${stored.length} rows`);
    const storedRowNumbers = new Set(stored.map((s) => s.submissionRowNumber));
    const storedIdByRow = new Map(stored.map((s) => [s.submissionRowNumber, s.id]));

    console.log("[GET /api/invoices] loading from sheets service...");
    let allFresh: typeof stored = [];
    let sheetsWarning: string | undefined;
    try {
      allFresh = await getSheetsService().loadSubmissions(month);
      console.log(`[GET /api/invoices] sheets returned ${allFresh.length} rows`);
    } catch (sheetsErr) {
      sheetsWarning = String(sheetsErr);
      console.warn("[GET /api/invoices] sheets service failed (returning stored data only):", sheetsErr);
    }
    const freshForMonth = allFresh.filter(
      (s) => parseSnapshotMonth(s.closingMonth) === month
    );

    // Build a row-number → submittedAt map so we can overlay the submission date
    // onto every row in the response. submittedAt comes from the Excel "Start time"
    // column and is not stored in the DB, so we re-derive it on every load.
    const submittedAtByRow = new Map(
      allFresh.map((s) => [s.submissionRowNumber, s.submittedAt])
    );

    // Find genuinely new rows (row number not yet in storage).
    // We never remove existing rows — only append — so old data is never wiped.
    const newRows = freshForMonth
      .filter((s) => !storedRowNumbers.has(s.submissionRowNumber))
      .map((s) => ({ ...s, id: storedIdByRow.get(s.submissionRowNumber) ?? s.id }));

    const withDates = (rows: typeof stored) =>
      rows.map((s) => ({ ...s, submittedAt: submittedAtByRow.get(s.submissionRowNumber) ?? s.submittedAt }));

    if (newRows.length === 0) {
      return NextResponse.json({ month, count: stored.length, submissions: withDates(stored), ...(sheetsWarning ? { sheetsWarning } : {}) });
    }

    const allToSave = [...stored, ...newRows];
    await getStorageService().saveSubmissions(allToSave, month);
    return NextResponse.json({ month, count: allToSave.length, submissions: withDates(allToSave), ...(sheetsWarning ? { sheetsWarning } : {}) });
  } catch (err) {
    console.error("[GET /api/invoices]", err);
    return NextResponse.json(
      { error: "Failed to load invoices", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    let ids: string[] | undefined;
    try {
      const body = await req.json() as { ids?: string[] };
      ids = Array.isArray(body.ids) ? body.ids : undefined;
    } catch {
      // no body — fall through to clear-all
    }

    const storage = getStorageService();
    const trash   = getTrashService();
    const now     = new Date().toISOString();

    if (ids && ids.length > 0) {
      // Load all months and find matching submissions to snapshot before deleting
      const months = await storage.listAvailableMonths();
      const allSubs = (await Promise.all(months.map((m) => storage.loadSubmissionsFromStore(m)))).flat();
      const toTrash = allSubs.filter((s) => ids!.includes(s.id));
      await Promise.all(
        toTrash.map((s) =>
          trash.addToTrash({
            trashId:    generateId("trash"),
            entityType: "invoice",
            entityId:   s.id,
            entityName: `${s.payerName} (${s.closingMonth ?? "?"})`,
            deletedAt:  now,
            data:       s,
          })
        )
      );
      await storage.deleteSubmissions(ids);
    } else {
      await storage.clearAllSubmissions();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/invoices]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
