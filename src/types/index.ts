// ─────────────────────────────────────────────────────────────────────────────
// types/index.ts — Core data models for SDC Invoice Tool
// ─────────────────────────────────────────────────────────────────────────────

// ── Internal status codes (always English, never localized) ──────────────────
export type InvoiceStatusCode =
  | "READY"
  | "REVIEW_REQUIRED"
  | "MISSING_ATTACHMENT"
  | "PDF_LINK_ERROR"
  | "DATE_MISSING"
  | "TAX_MISSING"
  | "AMOUNT_MISMATCH"
  | "PROJECT_INFO_MISSING"
  | "ALREADY_PROCESSED"
  | "DUPLICATE_FILE"
  | "SAVED"
  | "SAVE_ERROR";

// ── Language support ─────────────────────────────────────────────────────────
export type Language = "ja" | "en";

// ── Raw row from Google Sheets (column header → value) ──────────────────────
// These are the actual Japanese column names from the spreadsheet.
export interface RawSheetRow {
  rowIndex: number;
  "名前": string;
  "請求書の対象月末(締め日)を選択して下さい": string;
  "請求書の添付": string;
  "その他特記事項（何かあれば記載してください）": string;
  "※内部案件の場合のみ 部門を選択して下さい。": string;
  "※外部案件の場合のみ 案件名を選択してください。": string;
  "請求書の内訳(内部案件or外部案件)": string;
  "請求金額(税込) ※請求通貨で記入": string;
  "請求書の案件を": string;
  "支払": string;
  "金額": string;
  "支払処理": string;
}

// ── Normalized invoice submission (after column mapping) ─────────────────────
export interface InvoiceSubmission {
  id: string;                          // generated UUID
  submissionRowNumber: number;         // 1-based row index in spreadsheet
  submittedAt?: string;                // Start time (when the form was submitted)
  email: string;                       // （Email Address） from form
  payerName: string;                   // Name
  closingMonth: string;                // Which month does this invoice cover?
  invoiceAttachment: string;           // PDF upload field
  notes: string;                       // Additional Notes (if any)
  internalDepartment: string;          // For Internal Projects Only
  externalProjectName: string;         // For External Projects Only
  projectType: string;                 // Invoice Category
  claimedAmountTaxIncluded: string;    // Invoice Amount(local currency)
  invoiceProjectStatus: string;
  paymentStatus: string;
  paymentAmount: string;
  paymentProcessingStatus: string;
}

// ── Extracted fields from the actual invoice PDF/document ────────────────────
export interface ExtractedInvoiceFields {
  invoiceDate: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  taxRate: number | null;
  payeeName: string | null;
  payerNameOnDoc: string | null;
  rawText: string;                     // full extracted text for audit
}

// ── Validation result for a single invoice ───────────────────────────────────
export interface InvoiceValidationResult {
  submissionId: string;
  pdfAccessible: boolean;
  invoiceDateFound: boolean;
  taxIncluded: boolean;
  subtotalFound: boolean;
  totalFound: boolean;
  amountConsistent: boolean;           // subtotal + tax ≈ total
  amountMatchesSheet: boolean;         // sheet claimed amount ≈ invoice total
  duplicateDetected: boolean;
  statusCode: InvoiceStatusCode;
  issues: string[];                    // human-readable issue list (English keys)
  extractedFields: ExtractedInvoiceFields | null;
  proposedFilename: string;
  targetFolderPath: string;
  // Rule 10: human reviewer must explicitly approve before filing is allowed
  humanApproved?: boolean;
  // Sprint 2: vendor/contract/risk enrichment
  riskLevel?: RiskLevel;
  reviewerRecommendation?: string;
  vendorMatched?: boolean;
  contractMatched?: boolean;
  contractId?: string;
  // Audit trail
  validatedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  // Reviewer comments
  reviewerComment?: string;
  reviewerCommentAt?: string;
  // Money Forward
  mfBillingId?: string;
  mfBillingUrl?: string;
  mfSentAt?: string;
  // Escalation
  escalatedAt?: string;
}

// ── Stored document record (after successful Drive upload) ───────────────────
export interface FiledDocument {
  submissionId: string;
  originalFilename: string;
  newFilename: string;
  driveFolderId: string;
  driveFileId: string;
  driveWebViewLink: string;
  savedAt: string;                     // ISO timestamp
}

// ── Processing log entry ─────────────────────────────────────────────────────
export type LogStep =
  | "ROW_LOADED"
  | "FIELD_NORMALIZED"
  | "ATTACHMENT_FETCHED"
  | "PDF_EXTRACTED"
  | "VALIDATION_COMPLETE"
  | "FOLDER_RESOLVED"
  | "FILENAME_PREPARED"
  | "DUPLICATE_CHECK"
  | "FILE_UPLOADED"
  | "LOG_STORED"
  | "REMINDER_SENT"
  | "REMINDER_FAILED"
  | "REMINDER_SKIPPED"
  | "ERROR";

export interface ProcessingLog {
  id: string;
  runId: string;
  submissionId: string;
  step: LogStep;
  result: "OK" | "WARNING" | "ERROR" | "SKIP";
  message: string;
  timestamp: string;                   // ISO timestamp
}

// ── Processing run summary ───────────────────────────────────────────────────
export interface ProcessingRun {
  id: string;                          // runId
  month: string;                       // YYYY-MM
  startedAt: string;
  completedAt: string | null;
  totalRows: number;
  ready: number;
  reviewRequired: number;
  saved: number;
  errors: number;
  status: "RUNNING" | "COMPLETE" | "FAILED";
}

// ── App configuration (stored in Firestore / config file) ────────────────────
export interface AppConfig {
  // Status values in 支払処理 column that mean "already done, skip"
  completedStatuses: string[];
  // Status values that should be skipped entirely
  skipStatuses: string[];
  // How to derive the Drive month folder name from closingMonth
  // "YYYY-MM" | "YYYY年MM月" | "custom"
  monthFolderNamingMode: "YYYY-MM" | "YYYY年MM月" | "custom";
  // Template for custom folder naming (used when mode = "custom")
  monthFolderCustomTemplate: string;
  // Filename construction rule
  // Supported tokens: {payerName}, {originalFilename}, {closingMonth}
  filenameRule: string;
  // Default UI language
  defaultLanguage: Language;
  // Whether to check for duplicate files before uploading
  duplicateDetectionMode: "none" | "filename" | "hash";
  // Amount comparison tolerance (absolute, in sheet currency)
  amountToleranceAbsolute: number;
  // ── Phase 7: Reminder / notification settings ────────────────────────────
  teamsWebhookUrl?: string;
  staleReviewThresholdDays: number;   // days before stale review reminder fires
  dueDateThresholdDays: number;       // days before due date to send alert
  escalationRecipient?: string;       // Teams mention / email for overdue escalation
  paymentTermsDays: number;           // closingMonth end-of-month + N days = due date
}

// ── Risk level ───────────────────────────────────────────────────────────────
export type RiskLevel = "OK" | "NEEDS_REVIEW" | "BLOCKED";

// ── Vendor master ─────────────────────────────────────────────────────────────
export interface Vendor {
  id: string;
  name: string;
  aliases: string[];
  taxRegistrationNumber: string;
  bankAccountLast4: string;
  defaultReviewer: string;
  defaultProject: string;
  status: "active" | "inactive";
  createdAt: string;
}

// ── Contract master ───────────────────────────────────────────────────────────
export interface Contract {
  id: string;
  vendorId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  expectedMonthlyAmount: number;
  currency: string;
  paymentTerms: string;
  status: "active" | "expired" | "cancelled";
  createdAt: string;
}

// ── Dashboard summary stats ───────────────────────────────────────────────────
export interface DashboardStats {
  selectedMonth: string;
  totalRows: number;
  ready: number;
  reviewRequired: number;
  saved: number;
  errors: number;
  missingAttachment: number;
  alreadyProcessed: number;
}

// ── Combined view model for invoice list row ─────────────────────────────────
export interface InvoiceListItem {
  submission: InvoiceSubmission;
  validation: InvoiceValidationResult | null;
  filedDocument: FiledDocument | null;
}

// ── Phase 7: Reminder types ───────────────────────────────────────────────────
export type ReminderType =
  | "missing_invoice"
  | "stale_review"
  | "due_date_approaching"
  | "due_date_overdue"
  | "escalation";

export type ReminderChannel = "teams" | "mock";
export type ReminderStatus = "sent" | "failed" | "skipped";

export interface ReminderLog {
  id: string;
  reminderType: ReminderType;
  targetMonth: string;       // YYYY-MM
  vendorId?: string;
  submissionId?: string;
  contractId?: string;
  sentAt: string;            // ISO timestamp
  channel: ReminderChannel;
  status: ReminderStatus;
  message: string;
}

export interface ReminderGap {
  vendorId: string;
  vendorName: string;
  contractId: string;
  contractName: string;
  expectedAmount: number;
  currency: string;
}

export interface StaleReview {
  submissionId: string;
  payerName: string;
  statusCode: InvoiceStatusCode;
  staleDays: number;
  reviewer?: string;
}

export interface DueDateAlert {
  submissionId: string;
  payerName: string;
  dueDate: string;           // ISO date YYYY-MM-DD
  daysUntilDue: number;      // negative = overdue
  amount: string;
}

export interface ReminderSummary {
  missingInvoice: { count: number; total: number };
  staleReview: { count: number; oldestDays: number };
  dueDateApproaching: { count: number };
  dueDateOverdue: { count: number };
  lastSent: string | null;
  recentLogs: ReminderLog[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — Expense Claims
// ─────────────────────────────────────────────────────────────────────────────

export type ExpenseStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "paid";

export type ExpenseCategory =
  | "travel"
  | "meals"
  | "software"
  | "hardware"
  | "office"
  | "training"
  | "other";

export interface ExpenseClaim {
  id: string;
  submittedBy: string;           // name of employee
  submittedByEmail: string;
  submittedAt: string;           // ISO timestamp
  category: ExpenseCategory;
  purpose: string;               // description of why
  amount: number;
  currency: string;              // JPY, USD, etc.
  receiptAttachment?: string;    // URL / Drive link
  receiptFilename?: string;
  projectName?: string;
  notes?: string;
  status: ExpenseStatus;
  // Validation
  receiptAccessible?: boolean;
  extractedAmount?: number;
  extractedDate?: string;
  extractedVendor?: string;
  issues?: string[];
  // Review
  reviewedBy?: string;
  reviewedAt?: string;
  reviewerComment?: string;
  // MF
  mfEvidenceId?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — Outbound Invoices
// ─────────────────────────────────────────────────────────────────────────────

export type OutboundStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled";

export interface OutboundInvoice {
  id: string;
  clientName: string;
  clientEmail?: string;
  projectName: string;
  contractId?: string;
  invoiceNumber?: string;
  amount: number;
  currency: string;
  billingDate: string;           // YYYY-MM-DD
  dueDate: string;               // YYYY-MM-DD
  status: OutboundStatus;
  notes?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  sentAt?: string;
  paidAt?: string;
  paidAmount?: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — Monthly Close
// ─────────────────────────────────────────────────────────────────────────────

export type ChecklistItemStatus = "pending" | "done" | "skipped" | "blocked";

export interface MonthlyChecklistItem {
  id: string;
  month: string;                 // YYYY-MM
  category: string;              // e.g. "invoices", "bank", "tax"
  title: string;
  description?: string;
  status: ChecklistItemStatus;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
  sortOrder: number;
}

export interface BankSyncStatus {
  lastSyncAt: string | null;
  status: "ok" | "warning" | "error" | "unknown";
  message: string;
  unresolvedCount: number;
}
