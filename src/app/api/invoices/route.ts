// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSheetsService, getStorageService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter (expected YYYY-MM)" },
      { status: 400 }
    );
  }

  try {
    // Load what is already stored so we can preserve stable IDs.
    // Validation and filed-document records reference these IDs.
    const stored = await getStorageService().loadSubmissionsFromStore(month);
    const storedRowNumbers = new Set(stored.map((s) => s.submissionRowNumber));
    const storedIdByRow = new Map(stored.map((s) => [s.submissionRowNumber, s.id]));

    // Pull the latest responses from Microsoft Forms (OneDrive Excel / Graph API).
    // MicrosoftSheetsService returns ALL rows regardless of month, so we filter
    // by the correct month using parseSnapshotMonth which handles M/D/YY, YYYY年M月,
    // ISO, and other formats.
    const allFresh = await getSheetsService().loadSubmissions(month);
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
      return NextResponse.json({ month, count: stored.length, submissions: withDates(stored) });
    }

    const allToSave = [...stored, ...newRows];
    await getStorageService().saveSubmissions(allToSave, month);
    return NextResponse.json({ month, count: allToSave.length, submissions: withDates(allToSave) });
  } catch (err) {
    console.error("[GET /api/invoices]", err);
    return NextResponse.json(
      { error: "Failed to load invoices", detail: String(err) },
      { status: 500 }
    );
  }
}
