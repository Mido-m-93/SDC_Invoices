import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IDashboardService } from "../types";
import type { DashboardStats } from "@/types";

export class SupabaseDashboardService implements IDashboardService {
  private get db() {
    return getSupabaseClient();
  }

  async getStats(month: string): Promise<DashboardStats> {
    const db = this.db;

    // Fetch all submissions for the month
    const { data: submissions, error: subErr } = await db
      .from("invoice_submissions")
      .select("id")
      .eq("snapshot_month", month);
    if (subErr) throw new Error(`getStats submissions: ${subErr.message}`);

    const totalRows = submissions?.length ?? 0;
    if (totalRows === 0) {
      return { selectedMonth: month, totalRows: 0, ready: 0, reviewRequired: 0, saved: 0, errors: 0, missingAttachment: 0, alreadyProcessed: 0 };
    }

    const ids = (submissions ?? []).map((s) => s.id as string);

    // Fetch validation results for those submissions
    const { data: validations } = await db
      .from("invoice_validations")
      .select("status_code")
      .in("submission_id", ids);

    const counts: Record<string, number> = {};
    for (const v of validations ?? []) {
      const code = (v as { status_code: string }).status_code;
      counts[code] = (counts[code] ?? 0) + 1;
    }

    const ready = counts["READY"] ?? 0;
    const saved = counts["SAVED"] ?? 0;
    const reviewRequired = (counts["REVIEW_REQUIRED"] ?? 0) +
      (counts["DATE_MISSING"] ?? 0) +
      (counts["TAX_MISSING"] ?? 0) +
      (counts["AMOUNT_MISMATCH"] ?? 0) +
      (counts["PROJECT_INFO_MISSING"] ?? 0) +
      (counts["DUPLICATE_FILE"] ?? 0);
    const errors = (counts["PDF_LINK_ERROR"] ?? 0) + (counts["SAVE_ERROR"] ?? 0);
    const missingAttachment = counts["MISSING_ATTACHMENT"] ?? 0;
    const alreadyProcessed = counts["ALREADY_PROCESSED"] ?? 0;

    return { selectedMonth: month, totalRows, ready, reviewRequired, saved, errors, missingAttachment, alreadyProcessed };
  }
}
