// src/app/api/dashboard/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import type { DashboardStats } from "@/types";

export const maxDuration = 25;

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
    // Read only from storage — syncing from Microsoft Forms happens on the invoices page
    const submissions = await getStorageService().loadSubmissionsFromStore(month);
    console.log(`[stats] stored=${submissions.length} month=${month}`);

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
    const detail = String(err);
    console.error("[GET /api/dashboard/stats]", err);
    return NextResponse.json(
      { error: `Stats error: ${detail}`, detail },
      { status: 500 }
    );
  }
}
