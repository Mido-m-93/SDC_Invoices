// src/app/api/dashboard/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSheetsService, getStorageService } from "@/lib/services";
import { parseSnapshotMonth } from "@/lib/utils";
import type { DashboardStats } from "@/types";

const ERROR_CODES = new Set([
  "PDF_LINK_ERROR",
  "DATE_MISSING",
  "TAX_MISSING",
  "AMOUNT_MISMATCH",
  "PROJECT_INFO_MISSING",
  "SAVE_ERROR",
]);

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter (expected YYYY-MM)" },
      { status: 400 }
    );
  }
  try {
    // Sync fresh responses from Microsoft Forms, same logic as /api/invoices.
    const stored = await getStorageService().loadSubmissionsFromStore(month);
    const storedRowNumbers = new Set(stored.map((s) => s.submissionRowNumber));

    const allFresh = await getSheetsService().loadSubmissions(month);
    const newRows = allFresh
      .filter((s) => parseSnapshotMonth(s.closingMonth) === month)
      .filter((s) => !storedRowNumbers.has(s.submissionRowNumber));

    let submissions = stored;
    if (newRows.length > 0) {
      const allToSave = [...stored, ...newRows];
      await getStorageService().saveSubmissions(allToSave, month);
      submissions = allToSave;
    }

    const ids = submissions.map((s) => s.id);

    const [validationResults, filedDocs] = await Promise.all([
      getStorageService().loadValidationResults(ids),
      getStorageService().loadFiledDocuments(ids),
    ]);

    const validationMap = Object.fromEntries(validationResults.map((v) => [v.submissionId, v]));
    const filedSet = new Set(filedDocs.map((fd) => fd.submissionId));

    const stats: DashboardStats = {
      selectedMonth: month,
      totalRows: submissions.length,
      ready: submissions.filter((s) => validationMap[s.id]?.statusCode === "READY").length,
      reviewRequired: submissions.filter((s) => validationMap[s.id]?.statusCode === "REVIEW_REQUIRED").length,
      saved: submissions.filter((s) => filedSet.has(s.id)).length,
      errors: submissions.filter((s) => ERROR_CODES.has(validationMap[s.id]?.statusCode ?? "")).length,
      missingAttachment: submissions.filter((s) => {
        const code = validationMap[s.id]?.statusCode;
        return code === "MISSING_ATTACHMENT" || (!code && !s.invoiceAttachment);
      }).length,
      alreadyProcessed: submissions.filter((s) =>
        ["ALREADY_PROCESSED", "DUPLICATE_FILE"].includes(validationMap[s.id]?.statusCode ?? "")
      ).length,
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[GET /api/dashboard/stats]", err);
    return NextResponse.json(
      { error: "Failed to load dashboard stats", detail: String(err) },
      { status: 500 }
    );
  }
}
