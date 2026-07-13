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
  currency?: string;                   // Currency code e.g. USD, JPY (defaults to JPY)
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
  memberName: string | null;       // invoice issuer = the member/contractor (receives payment)
  payerNameOnDoc: string | null;  // company being billed = SDC
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
  // Money Forward integration
  mfBillingId?: string;
  mfBillingUrl?: string;
  mfSentAt?: string;
  // Escalation / exception tracking
  escalatedAt?: string;
  reviewerComment?: string;
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

// ── Proposal ─────────────────────────────────────────────────────────────────
export interface Proposal {
  id: string;
  clientId: string;       // proposal sent TO a client (was vendorId)
  clientName?: string;    // display name resolved from Client record
  projectName: string;
  proposalDate: string;
  estimatedAmount: number;
  currency: string;
  description: string;
  status: "draft" | "submitted" | "accepted" | "rejected" | "expired";
  contractId?: string;
  folderUrl?: string;
  createdAt: string;
}

// ── Contract master ───────────────────────────────────────────────────────────
export interface Contract {
  id: string;
  vendorId: string;            // contractor delivering the work (may be "" for client-only contracts)
  clientId?: string;           // client the contract is for (pipeline: Proposal → Contract)
  clientName?: string;         // display name
  projectName: string;
  startDate: string;
  endDate: string;
  expectedMonthlyAmount: number;
  currency: string;
  paymentTerms: string;
  status: "active" | "expired" | "cancelled";
  proposalId?: string;
  contractFolderUrl?: string;
  createdAt: string;
}

// ── Payment record ────────────────────────────────────────────────────────────
export type PaymentRecordStatus = "pending" | "confirmed" | "failed" | "reconciled";

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  contractId: string;
  vendorId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  status: PaymentRecordStatus;
  confirmedBy?: string;
  confirmedAt?: string;
  notes?: string;
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
  | "missing_expense_receipt"
  | "stale_expense_review"
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

// ── Phase 8: Expense reimbursement ───────────────────────────────────────────

export type ExpenseCategory =
  | "transport"
  | "accommodation"
  | "meals"
  | "software"
  | "hardware"
  | "office_supplies"
  | "communication"
  | "entertainment"
  | "training"
  | "other";

export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "paid"
  | "archived";

export type ExpensePaymentMethod =
  | "company_card"
  | "invoice_payment"
  | "personal_reimbursement";

export interface ExpenseClaim {
  id: string;
  submittedBy: string;
  submittedByEmail: string;
  submittedAt: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  paymentMethod: ExpensePaymentMethod;
  receiptUrl: string;
  receiptFilename: string;
  projectName: string;
  internalDepartment: string;
  expenseDate: string;
  status: ExpenseStatus;
  reviewerComment: string;
  reviewedBy: string;
  reviewedAt: string | null;
  approvedBy: string;
  approvedAt: string | null;
  paidAt: string | null;
  extractedAmount: number | null;
  extractedDate: string | null;
  extractedVendor: string | null;
  policyViolations: string[];
  bankAccount?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseValidationResult {
  claimId: string;
  receiptAccessible: boolean;
  amountMatchesReceipt: boolean;
  dateFound: boolean;
  categoryValid: boolean;
  receiptMissing: boolean;
  policyViolations: string[];
  riskLevel: RiskLevel;
  statusCode: ExpenseStatus;
  extractedAmount: number | null;
  extractedDate: string | null;
  extractedVendor: string | null;
}

// ── Phase 9: Outbound invoice support ─────────────────────────────────────────

export type OutboundInvoiceStatus =
  | "draft"
  | "pending_approval"
  | "sent"
  | "overdue"
  | "paid"
  | "cancelled";

// OutboundStatus defined below as alias for OutboundInvoiceStatus

export interface OutboundInvoice {
  id: string;
  contractId: string;
  clientId: string;
  clientName: string;
  projectName: string;
  invoiceNumber: string;
  billingMonth: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: OutboundInvoiceStatus;
  notes: string;
  sentAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  createdBy: string;
  approvedBy: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Compact outbound view fields
  clientEmail?: string;
  amount?: number;
  billingDate?: string;
  driveFileId?: string;
  driveFileUrl?: string;
}

export interface OutboundInvoiceSummary {
  total: number;
  draft: number;
  pendingApproval: number;
  sent: number;
  overdue: number;
  paid: number;
  totalOutstanding: number;
  currency: string;
}

// ── Phase 10: Monthly close checklist ─────────────────────────────────────────

export type CloseChecklistItemStatus = "pending" | "in_progress" | "done" | "blocked" | "na" | "skipped";

export interface CloseChecklistItem {
  id: string;
  month: string;
  category: string;
  title: string;
  titleJa: string;
  description: string;
  status: CloseChecklistItemStatus;
  assignee: string;
  completedBy: string;
  completedAt: string | null;
  notes: string;
  sortOrder: number;
}

export interface MonthlyCloseChecklist {
  month: string;
  items: CloseChecklistItem[];
  totalItems: number;
  doneItems: number;
  blockedItems: number;
  completedAt: string | null;
}

// ChecklistItemStatus and MonthlyChecklistItem defined below with full type aliases

export interface BankSyncStatus {
  lastSyncAt: string | null;
  status: "ok" | "warning" | "error" | "unknown";
  message: string;
  unresolvedCount: number;
}

// ── Phase 11: Client Management ───────────────────────────────────────────────
export type ClientStatus = "active" | "inactive" | "prospect";

export interface Client {
  id: string;
  name: string;
  legalName: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  country: string;
  taxRegistrationNumber: string;
  status: ClientStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ── Phase 11: Lead Management ─────────────────────────────────────────────────
export type LeadStage = "new" | "contacted" | "qualified" | "proposal_sent" | "negotiation" | "won" | "lost" | "on_hold";
export type LeadSource = "referral" | "inbound" | "outbound" | "event" | "partner" | "other";

export interface Lead {
  id: string;
  clientId: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  source: LeadSource;
  stage: LeadStage;
  title: string;
  estimatedValue: number;
  currency: string;
  probability: number;
  expectedCloseDate: string;
  assignedTo: string;
  proposalId: string | null;
  notes: string;
  lostReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadSummary {
  total: number;
  byStage: Record<LeadStage, number>;
  totalPipelineValue: number;
  currency: string;
  wonThisMonth: number;
  lostThisMonth: number;
}

// ── Phase 11: Member / Employee Management ────────────────────────────────────
export type MemberRole = "admin" | "sales" | "accounting" | "engineer" | "designer" | "manager" | "other";
export type MemberStatus = "active" | "inactive" | "on_leave";

export interface Member {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  role: MemberRole;
  department: string;
  employeeCode: string;
  joinDate: string;
  status: MemberStatus;
  avatarUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ── Phase 11: Accounting Layer ────────────────────────────────────────────────
export type AccountingEntryType = "revenue" | "expense" | "adjustment" | "transfer";
export type AccountingEntryStatus = "draft" | "posted" | "voided";

export interface AccountingEntry {
  id: string;
  entryDate: string;
  month: string;
  type: AccountingEntryType;
  category: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountJpy: number;
  status: AccountingEntryStatus;
  sourceType: string;
  sourceId: string;
  clientId: string;
  vendorId: string;
  memberId: string;
  notes: string;
  postedBy: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfitAndLoss {
  month: string;
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  grossMarginPct: number;
  byCategory: Array<{ category: string; type: AccountingEntryType; total: number }>;
  currency: string;
}

export interface AccountingSummary {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
  entryCount: number;
  draftCount: number;
  currency: string;
}

// ── Type aliases for compatibility ───────────────────────────────────────────
export type ChecklistItemStatus = CloseChecklistItemStatus;
export type OutboundStatus = OutboundInvoiceStatus;

// Simpler checklist item shape used by SupabaseCloseService / MockCloseService
export interface MonthlyChecklistItem {
  id: string;
  month: string;
  category: string;
  title: string;
  description?: string;
  status: CloseChecklistItemStatus;
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

export interface DriveFolder {
  folderId: string;
  folderName: string;
}

export interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink: string;
  createdAt?: string;
}

// ── Phase 11: Reporting Dashboard ─────────────────────────────────────────────
export interface ReportingKPIs {
  month: string;
  leadsTotal: number;
  leadsWon: number;
  leadsLost: number;
  leadConversionRate: number;
  proposalsTotal: number;
  proposalsAccepted: number;
  proposalWinRate: number;
  outboundInvoicesTotal: number;
  outboundInvoicesPaid: number;
  outboundInvoicesOverdue: number;
  invoiceCollectionRate: number;
  totalOutstandingJpy: number;
  totalRevenueJpy: number;
  totalExpensesJpy: number;
  netProfitJpy: number;
  grossMarginPct: number;
  expensesTotal: number;
  expensesApproved: number;
  expensesRejected: number;
  activeVendors: number;
  activeContracts: number;
  vendorsWithMissingInvoice: number;
}
