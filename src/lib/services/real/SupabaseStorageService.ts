import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IStorageService } from "../types";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  AppConfig,
} from "@/types";

const DEFAULT_CONFIG: AppConfig = {
  completedStatuses: ["支払済"],
  skipStatuses: [],
  monthFolderNamingMode: "YYYY-MM",
  monthFolderCustomTemplate: "",
  filenameRule: "{payerName}_{closingMonth}_{originalFilename}",
  defaultLanguage: "ja",
  duplicateDetectionMode: "filename",
  amountToleranceAbsolute: 1,
  teamsWebhookUrl: "",
  staleReviewThresholdDays: 3,
  dueDateThresholdDays: 5,
  escalationRecipient: "",
  paymentTermsDays: 30,
};

// ── Row mappers ───────────────────────────────────────────────────────────────

function toSubmissionRow(s: InvoiceSubmission, month: string): Record<string, unknown> {
  return {
    id: s.id,
    snapshot_month: month,
    submission_row_number: s.submissionRowNumber,
    email: s.email,
    payer_name: s.payerName,
    closing_month: s.closingMonth,
    invoice_attachment: s.invoiceAttachment,
    notes: s.notes,
    internal_department: s.internalDepartment,
    external_project_name: s.externalProjectName,
    project_type: s.projectType,
    claimed_amount_tax_included: s.claimedAmountTaxIncluded,
    invoice_project_status: s.invoiceProjectStatus,
    payment_status: s.paymentStatus,
    payment_amount: s.paymentAmount,
    payment_processing_status: s.paymentProcessingStatus,
  };
}

function fromSubmissionRow(row: Record<string, unknown>): InvoiceSubmission {
  return {
    id: row.id as string,
    submissionRowNumber: row.submission_row_number as number,
    email: row.email as string,
    payerName: row.payer_name as string,
    closingMonth: row.closing_month as string,
    invoiceAttachment: row.invoice_attachment as string,
    notes: row.notes as string,
    internalDepartment: row.internal_department as string,
    externalProjectName: row.external_project_name as string,
    projectType: row.project_type as string,
    claimedAmountTaxIncluded: row.claimed_amount_tax_included as string,
    invoiceProjectStatus: row.invoice_project_status as string,
    paymentStatus: row.payment_status as string,
    paymentAmount: row.payment_amount as string,
    paymentProcessingStatus: row.payment_processing_status as string,
  };
}

function toValidationRow(r: InvoiceValidationResult): Record<string, unknown> {
  return {
    submission_id: r.submissionId,
    pdf_accessible: r.pdfAccessible,
    invoice_date_found: r.invoiceDateFound,
    tax_included: r.taxIncluded,
    subtotal_found: r.subtotalFound,
    total_found: r.totalFound,
    amount_consistent: r.amountConsistent,
    amount_matches_sheet: r.amountMatchesSheet,
    duplicate_detected: r.duplicateDetected,
    status_code: r.statusCode,
    issues: r.issues,
    extracted_fields: r.extractedFields ?? null,
    proposed_filename: r.proposedFilename,
    target_folder_path: r.targetFolderPath,
    human_approved: r.humanApproved ?? null,
    risk_level: r.riskLevel ?? null,
    reviewer_recommendation: r.reviewerRecommendation ?? null,
    vendor_matched: r.vendorMatched ?? null,
    contract_matched: r.contractMatched ?? null,
    contract_id: r.contractId ?? null,
    validated_by: r.validatedBy ?? null,
    approved_by: r.approvedBy ?? null,
    approved_at: r.approvedAt ?? null,
    reviewer_comment: r.reviewerComment ?? null,
    reviewer_comment_at: r.reviewerCommentAt ?? null,
    mf_billing_id: r.mfBillingId ?? null,
    mf_billing_url: r.mfBillingUrl ?? null,
    mf_sent_at: r.mfSentAt ?? null,
    escalated_at: r.escalatedAt ?? null,
  };
}

function fromValidationRow(row: Record<string, unknown>): InvoiceValidationResult {
  return {
    submissionId: row.submission_id as string,
    pdfAccessible: row.pdf_accessible as boolean,
    invoiceDateFound: row.invoice_date_found as boolean,
    taxIncluded: row.tax_included as boolean,
    subtotalFound: row.subtotal_found as boolean,
    totalFound: row.total_found as boolean,
    amountConsistent: row.amount_consistent as boolean,
    amountMatchesSheet: row.amount_matches_sheet as boolean,
    duplicateDetected: row.duplicate_detected as boolean,
    statusCode: row.status_code as InvoiceValidationResult["statusCode"],
    issues: (row.issues as string[]) ?? [],
    extractedFields: (row.extracted_fields as InvoiceValidationResult["extractedFields"]) ?? null,
    proposedFilename: row.proposed_filename as string,
    targetFolderPath: row.target_folder_path as string,
    humanApproved: row.human_approved as boolean | undefined,
    riskLevel: row.risk_level as InvoiceValidationResult["riskLevel"],
    reviewerRecommendation: row.reviewer_recommendation as string | undefined,
    vendorMatched: row.vendor_matched as boolean | undefined,
    contractMatched: row.contract_matched as boolean | undefined,
    contractId: row.contract_id as string | undefined,
    validatedBy: (row.validated_by as string) || undefined,
    approvedBy: (row.approved_by as string) || undefined,
    approvedAt: (row.approved_at as string) || undefined,
    reviewerComment: (row.reviewer_comment as string) || undefined,
    reviewerCommentAt: (row.reviewer_comment_at as string) || undefined,
    mfBillingId: (row.mf_billing_id as string) || undefined,
    mfBillingUrl: (row.mf_billing_url as string) || undefined,
    mfSentAt: (row.mf_sent_at as string) || undefined,
    escalatedAt: (row.escalated_at as string) || undefined,
  };
}

function toFiledRow(doc: FiledDocument): Record<string, unknown> {
  return {
    submission_id: doc.submissionId,
    original_filename: doc.originalFilename,
    new_filename: doc.newFilename,
    drive_folder_id: doc.driveFolderId,
    drive_file_id: doc.driveFileId,
    drive_web_view_link: doc.driveWebViewLink,
    saved_at: doc.savedAt,
  };
}

function fromFiledRow(row: Record<string, unknown>): FiledDocument {
  return {
    submissionId: row.submission_id as string,
    originalFilename: row.original_filename as string,
    newFilename: row.new_filename as string,
    driveFolderId: row.drive_folder_id as string,
    driveFileId: row.drive_file_id as string,
    driveWebViewLink: row.drive_web_view_link as string,
    savedAt: row.saved_at as string,
  };
}

function toRunRow(run: ProcessingRun): Record<string, unknown> {
  return {
    id: run.id,
    month: run.month,
    started_at: run.startedAt,
    completed_at: run.completedAt ?? null,
    total_rows: run.totalRows,
    ready: run.ready,
    review_required: run.reviewRequired,
    saved: run.saved,
    errors: run.errors,
    status: run.status,
  };
}

function fromRunRow(row: Record<string, unknown>): ProcessingRun {
  return {
    id: row.id as string,
    month: row.month as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
    totalRows: row.total_rows as number,
    ready: row.ready as number,
    reviewRequired: row.review_required as number,
    saved: row.saved as number,
    errors: row.errors as number,
    status: row.status as ProcessingRun["status"],
  };
}

function toLogRow(log: ProcessingLog): Record<string, unknown> {
  return {
    id: log.id,
    run_id: log.runId,
    submission_id: log.submissionId,
    step: log.step,
    result: log.result,
    message: log.message,
    timestamp: log.timestamp,
  };
}

function fromLogRow(row: Record<string, unknown>): ProcessingLog {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    submissionId: row.submission_id as string,
    step: row.step as ProcessingLog["step"],
    result: row.result as ProcessingLog["result"],
    message: row.message as string,
    timestamp: row.timestamp as string,
  };
}

function fromConfigRow(row: Record<string, unknown>): AppConfig {
  return {
    completedStatuses: (row.completed_statuses as string[]) ?? [],
    skipStatuses: (row.skip_statuses as string[]) ?? [],
    monthFolderNamingMode: (row.month_folder_naming_mode as AppConfig["monthFolderNamingMode"]) ?? "YYYY-MM",
    monthFolderCustomTemplate: (row.month_folder_custom_template as string) ?? "",
    filenameRule: (row.filename_rule as string) ?? DEFAULT_CONFIG.filenameRule,
    defaultLanguage: (row.default_language as AppConfig["defaultLanguage"]) ?? "ja",
    duplicateDetectionMode: (row.duplicate_detection_mode as AppConfig["duplicateDetectionMode"]) ?? "filename",
    amountToleranceAbsolute: (row.amount_tolerance_absolute as number) ?? 1,
    teamsWebhookUrl: (row.teams_webhook_url as string) ?? "",
    staleReviewThresholdDays: (row.stale_review_threshold_days as number) ?? 3,
    dueDateThresholdDays: (row.due_date_threshold_days as number) ?? 5,
    escalationRecipient: (row.escalation_recipient as string) ?? "",
    paymentTermsDays: (row.payment_terms_days as number) ?? 30,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SupabaseStorageService implements IStorageService {
  private get db() {
    return getSupabaseClient();
  }

  async saveSubmissions(submissions: InvoiceSubmission[], month: string): Promise<void> {
    if (submissions.length === 0) return;
    // Delete existing rows for this month first so re-uploading the same CSV
    // doesn't create duplicates (generateId() produces new UUIDs each upload).
    const { error: delErr } = await this.db
      .from("invoice_submissions")
      .delete()
      .eq("snapshot_month", month);
    if (delErr) throw new Error(`saveSubmissions (delete): ${delErr.message}`);
    const rows = submissions.map((s) => toSubmissionRow(s, month));
    const { error } = await this.db.from("invoice_submissions").insert(rows);
    if (error) throw new Error(`saveSubmissions (insert): ${error.message}`);
  }

  async listAvailableMonths(): Promise<string[]> {
    const { data, error } = await this.db
      .from("invoice_submissions")
      .select("snapshot_month")
      .order("snapshot_month", { ascending: false });
    if (error) throw new Error(`listAvailableMonths: ${error.message}`);
    const seen = new Set<string>();
    for (const row of data ?? []) {
      const m = (row as Record<string, unknown>).snapshot_month as string;
      if (m && m !== "unknown") seen.add(m);
    }
    return Array.from(seen);
  }

  async loadSubmissionsFromStore(month: string): Promise<InvoiceSubmission[]> {
    const { data, error } = await this.db
      .from("invoice_submissions")
      .select("*")
      .eq("snapshot_month", month)
      .order("submission_row_number", { ascending: true });
    if (error) throw new Error(`loadSubmissionsFromStore: ${error.message}`);
    return (data ?? []).map((r) => fromSubmissionRow(r as Record<string, unknown>));
  }

  async saveValidationResult(result: InvoiceValidationResult): Promise<void> {
    const { error } = await this.db
      .from("invoice_validations")
      .upsert(toValidationRow(result), { onConflict: "submission_id" });
    if (error) throw new Error(`saveValidationResult: ${error.message}`);
  }

  async saveFiledDocument(doc: FiledDocument): Promise<void> {
    const { error } = await this.db
      .from("filed_documents")
      .upsert(toFiledRow(doc), { onConflict: "submission_id" });
    if (error) throw new Error(`saveFiledDocument: ${error.message}`);
  }

  async loadValidationResults(submissionIds: string[]): Promise<InvoiceValidationResult[]> {
    if (submissionIds.length === 0) return [];
    const { data, error } = await this.db
      .from("invoice_validations")
      .select("*")
      .in("submission_id", submissionIds);
    if (error) throw new Error(`loadValidationResults: ${error.message}`);
    return (data ?? []).map((r) => fromValidationRow(r as Record<string, unknown>));
  }

  async loadFiledDocuments(submissionIds: string[]): Promise<FiledDocument[]> {
    if (submissionIds.length === 0) return [];
    const { data, error } = await this.db
      .from("filed_documents")
      .select("*")
      .in("submission_id", submissionIds);
    if (error) throw new Error(`loadFiledDocuments: ${error.message}`);
    return (data ?? []).map((r) => fromFiledRow(r as Record<string, unknown>));
  }

  async loadRuns(): Promise<ProcessingRun[]> {
    const { data, error } = await this.db
      .from("processing_runs")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(`loadRuns: ${error.message}`);
    return (data ?? []).map((r) => fromRunRow(r as Record<string, unknown>));
  }

  async saveRun(run: ProcessingRun): Promise<void> {
    const { error } = await this.db
      .from("processing_runs")
      .upsert(toRunRow(run), { onConflict: "id" });
    if (error) throw new Error(`saveRun: ${error.message}`);
  }

  async appendLog(log: ProcessingLog): Promise<void> {
    const { error } = await this.db
      .from("processing_logs")
      .insert(toLogRow(log));
    if (error) throw new Error(`appendLog: ${error.message}`);
  }

  async loadLogs(runId: string): Promise<ProcessingLog[]> {
    const { data, error } = await this.db
      .from("processing_logs")
      .select("*")
      .eq("run_id", runId)
      .order("timestamp", { ascending: true });
    if (error) throw new Error(`loadLogs: ${error.message}`);
    return (data ?? []).map((r) => fromLogRow(r as Record<string, unknown>));
  }

  async loadConfig(): Promise<AppConfig> {
    const { data, error } = await this.db
      .from("app_config")
      .select("*")
      .eq("id", "main")
      .single();
    if (error || !data) return DEFAULT_CONFIG;
    return fromConfigRow(data as Record<string, unknown>);
  }

  async saveConfig(config: AppConfig): Promise<void> {
    const { error } = await this.db.from("app_config").upsert(
      {
        id: "main",
        completed_statuses: config.completedStatuses,
        skip_statuses: config.skipStatuses,
        month_folder_naming_mode: config.monthFolderNamingMode,
        month_folder_custom_template: config.monthFolderCustomTemplate,
        filename_rule: config.filenameRule,
        default_language: config.defaultLanguage,
        duplicate_detection_mode: config.duplicateDetectionMode,
        amount_tolerance_absolute: config.amountToleranceAbsolute,
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(`saveConfig: ${error.message}`);
  }
}
