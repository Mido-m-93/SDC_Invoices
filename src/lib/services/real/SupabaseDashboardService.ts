// lib/services/real/SupabaseDashboardService.ts
import { createClient } from "@supabase/supabase-js";
import type { IDashboardService } from "../types";
import type { DashboardStats } from "@/types";

const REVIEW_CODES = new Set([
  "REVIEW_REQUIRED",
  "MISSING_ATTACHMENT",
  "PDF_LINK_ERROR",
  "DATE_MISSING",
  "TAX_MISSING",
  "AMOUNT_MISMATCH",
  "PROJECT_INFO_MISSING",
]);

const ERROR_CODES = new Set([
  "PDF_LINK_ERROR",
  "AMOUNT_MISMATCH",
  "DUPLICATE_FILE",
  "SAVE_ERROR",
]);

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export class SupabaseDashboardService implements IDashboardService {
  async getStats(month: string): Promise<DashboardStats> {
    const db = getSupabase();

    // All submissions for this month
    const { data: submissions } = await db
      .from("invoice_submissions")
      .select("id, invoice_attachment")
      .eq("snapshot_month", month);

    const submissionIds = (submissions ?? []).map((s) => s.id as string);
    const totalRows = submissionIds.length;

    if (totalRows === 0) {
      return { selectedMonth: month, totalRows: 0, ready: 0, reviewRequired: 0, saved: 0, errors: 0, missingAttachment: 0, alreadyProcessed: 0 };
    }

    // Validations for these submissions
    const { data: validations } = await db
      .from("invoice_validations")
      .select("submission_id, status_code, human_approved")
      .in("submission_id", submissionIds);

    // Filed documents for these submissions
    const { data: filed } = await db
      .from("filed_documents")
      .select("submission_id")
      .in("submission_id", submissionIds);

    const validationMap = new Map(
      (validations ?? []).map((v) => [v.submission_id as string, v])
    );
    const savedIds = new Set((filed ?? []).map((f) => f.submission_id as string));

    let ready = 0;
    let reviewRequired = 0;
    let errors = 0;
    let missingAttachment = 0;
    let alreadyProcessed = 0;

    for (const sub of submissions ?? []) {
      const v = validationMap.get(sub.id);
      const code = v?.status_code as string | undefined;

      if (!code) continue;

      if (code === "READY" || code === "SAVED") ready++;
      else if (code === "ALREADY_PROCESSED") alreadyProcessed++;
      else if (code === "MISSING_ATTACHMENT") { reviewRequired++; missingAttachment++; }
      else if (REVIEW_CODES.has(code)) reviewRequired++;
      else if (ERROR_CODES.has(code)) errors++;
    }

    // Also count submissions with no attachment in the raw data
    const noAttachmentCount = (submissions ?? []).filter((s) => !s.invoice_attachment).length;
    missingAttachment = Math.max(missingAttachment, noAttachmentCount);

    return {
      selectedMonth: month,
      totalRows,
      ready,
      reviewRequired,
      saved: savedIds.size,
      errors,
      missingAttachment,
      alreadyProcessed,
    };
  }
}
