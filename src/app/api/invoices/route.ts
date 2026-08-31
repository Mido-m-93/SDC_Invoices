// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSheetsService, getStorageService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";
import type { InvoiceSubmission } from "@/types";

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

    // Storage and Sheets are independent data sources — fetch concurrently
    // instead of sequentially. Sheets is the slow one (Microsoft Graph round
    // trip), so this halves wall-clock time instead of adding the two waits.
    console.log("[GET /api/invoices] loading from storage + sheets concurrently...");
    const [stored, sheetsOutcome] = await Promise.all([
      getStorageService().loadSubmissionsFromStore(month),
      getSheetsService().loadSubmissions(month)
        .then((rows) => ({ rows, error: undefined as string | undefined }))
        .catch((sheetsErr) => {
          console.warn("[GET /api/invoices] sheets service failed (returning stored data only):", sheetsErr);
          return { rows: [] as InvoiceSubmission[], error: String(sheetsErr) };
        }),
    ]);
    console.log(`[GET /api/invoices] storage returned ${stored.length} rows, sheets returned ${sheetsOutcome.rows.length} rows`);

    const storedRowNumbers = new Set(stored.map((s) => s.submissionRowNumber));
    const storedIdByRow = new Map(stored.map((s) => [s.submissionRowNumber, s.id]));
    const allFresh = sheetsOutcome.rows;
    const sheetsWarning = sheetsOutcome.error;
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
    // loadSubmissionsFromStore() deliberately includes soft-deleted rows (see
    // its own comment) so they survive the save-back below — strip them out
    // only for what actually gets sent to the frontend.
    const visible = (rows: typeof stored) => withDates(rows).filter((s) => !s.deletedAt);

    if (newRows.length === 0) {
      const submissions = visible(stored);
      return NextResponse.json({ month, count: submissions.length, submissions, ...(sheetsWarning ? { sheetsWarning } : {}) });
    }

    const allToSave = [...stored, ...newRows];
    await getStorageService().saveSubmissions(allToSave, month);
    const submissions = visible(allToSave);
    return NextResponse.json({ month, count: submissions.length, submissions, ...(sheetsWarning ? { sheetsWarning } : {}) });
  } catch (err) {
    console.error("[GET /api/invoices]", err);
    return NextResponse.json(
      { error: "Failed to load invoices", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await getStorageService().clearAllSubmissions();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/invoices]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
