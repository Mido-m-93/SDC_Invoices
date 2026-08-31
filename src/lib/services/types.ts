// ─────────────────────────────────────────────────────────────────────────────
// lib/services/types.ts — Service interface contracts
//
// Define interfaces here so mock and real implementations are interchangeable.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  DashboardStats,
  AppConfig,
  Vendor,
  Contract,
  Proposal,
  PaymentRecord,
  PaymentRecordStatus,
  ReminderType,
  ReminderLog,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ReminderSummary,
  ExpenseClaim,
  ExpenseValidationResult,
  ExpenseStatus,
  OutboundInvoice,
  OutboundInvoiceStatus,
  OutboundInvoiceSummary,
  CloseChecklistItem,
  MonthlyCloseChecklist,
  CloseChecklistItemStatus,
  MonthlyChecklistItem,
  BankSyncStatus,
  Client,
  ClientStatus,
  Lead,
  LeadStage,
  LeadSummary,
  Member,
  MemberStatus,
  AccountingEntry,
  AccountingEntryType,
  AccountingEntryStatus,
  ProfitAndLoss,
  AccountingSummary,
  ReportingKPIs,
} from "@/types";

// ── Sheets service ────────────────────────────────────────────────────────────
export interface ISheetsService {
  /**
   * Load and normalize all invoice rows for the given month.
   * month format: "YYYY-MM"
   */
  loadSubmissions(month: string): Promise<InvoiceSubmission[]>;
}

// ── Drive service ─────────────────────────────────────────────────────────────
export interface DriveFolder { folderId: string; folderName: string; }
export interface DriveFile { fileId: string; filename: string; mimeType: string; webViewLink: string; }

export interface IDriveService {
  fetchAttachment(
    url: string
  ): Promise<{ filename: string; mimeType: string; data: Uint8Array } | null>;

  uploadPdf(params: {
    folderId: string;
    filename: string;
    data: Uint8Array;
  }): Promise<{ fileId: string; webViewLink: string }>;

  ensureMonthFolder(params: {
    rootFolderId: string;
    folderName: string;
  }): Promise<string>;

  checkDuplicate(params: {
    folderId: string;
    filename: string;
  }): Promise<boolean>;

  listMonthFolders(rootFolderId: string): Promise<DriveFolder[]>;
  listFilesInFolder(folderId: string): Promise<DriveFile[]>;
  downloadById(fileId: string): Promise<Uint8Array>;
}

// ── Validation service ────────────────────────────────────────────────────────
export interface IValidationService {
  /**
   * Validate a single invoice submission.
   * Performs PDF extraction + field checks + amount comparison.
   */
  validate(
    submission: InvoiceSubmission
  ): Promise<InvoiceValidationResult>;

  /**
   * Validate all submissions in a batch.
   */
  validateBatch(
    submissions: InvoiceSubmission[]
  ): Promise<InvoiceValidationResult[]>;
}

// ── Firestore / storage service ───────────────────────────────────────────────
export interface IStorageService {
  /** Save invoice submissions snapshot for a given month */
  saveSubmissions(submissions: InvoiceSubmission[], month: string): Promise<void>;

  /** Soft-delete ALL submissions across all months (recoverable from Archives) */
  clearAllSubmissions(deletedBy?: string): Promise<void>;

  /** Load saved submissions for a given month (includes soft-deleted rows — see impl for why) */
  loadSubmissionsFromStore(month: string): Promise<InvoiceSubmission[]>;

  /** Soft-delete a single submission row by id */
  deleteSubmission(id: string, deletedBy?: string): Promise<void>;

  /** Undo a soft-delete on a single submission row */
  restoreSubmission(id: string): Promise<void>;

  /** All soft-deleted submission rows, across all months */
  listDeletedSubmissions(): Promise<InvoiceSubmission[]>;

  /** Patch the currency field on a single stored submission */
  patchSubmissionCurrency(submissionId: string, month: string, currency: string): Promise<void>;

  /** List all months that have at least one saved submission */
  listAvailableMonths(): Promise<string[]>;

  /** Save a validation result */
  saveValidationResult(result: InvoiceValidationResult): Promise<void>;

  /** Save a filed document record */
  saveFiledDocument(doc: FiledDocument): Promise<void>;

  /** Load validation results for a run */
  loadValidationResults(
    submissionIds: string[]
  ): Promise<InvoiceValidationResult[]>;

  /** Load filed documents for submissions */
  loadFiledDocuments(submissionIds: string[]): Promise<FiledDocument[]>;

  /** Load all processing runs */
  loadRuns(): Promise<ProcessingRun[]>;

  /** Save a processing run */
  saveRun(run: ProcessingRun): Promise<void>;

  /** Delete ALL processing runs (and their logs, via cascade) */
  clearAllRuns(): Promise<void>;

  /** Append a log entry */
  appendLog(log: ProcessingLog): Promise<void>;

  /** Load logs for a run */
  loadLogs(runId: string): Promise<ProcessingLog[]>;

  /** Load app config */
  loadConfig(): Promise<AppConfig>;

  /** Save app config */
  saveConfig(config: AppConfig): Promise<void>;
}

// ── Dashboard service ─────────────────────────────────────────────────────────
export interface IDashboardService {
  getStats(month: string): Promise<DashboardStats>;
}

// ── Vendor service ────────────────────────────────────────────────────────────
export interface IVendorService {
  listVendors(): Promise<Vendor[]>;
  saveVendor(vendor: Vendor): Promise<void>;
  deleteVendor(id: string): Promise<void>;
}

// ── Contract service ──────────────────────────────────────────────────────────
export interface IContractService {
  listContracts(): Promise<Contract[]>;
  saveContract(contract: Contract): Promise<void>;
  deleteContract(id: string): Promise<void>;
}

// ── Proposal service ──────────────────────────────────────────────────────────
export interface IProposalService {
  listProposals(): Promise<Proposal[]>;
  saveProposal(proposal: Proposal): Promise<void>;
  deleteProposal(id: string, deletedBy?: string): Promise<void>;
  restoreProposal(id: string): Promise<void>;
  listDeletedProposals(): Promise<Proposal[]>;
}

// ── Payment record service ────────────────────────────────────────────────────
export interface IPaymentRecordService {
  listPaymentRecords(filters?: { invoiceId?: string; contractId?: string; status?: PaymentRecordStatus }): Promise<PaymentRecord[]>;
  savePaymentRecord(record: PaymentRecord): Promise<void>;
  deletePaymentRecord(id: string): Promise<void>;
}

// ── Notification service (Phase 7) ───────────────────────────────────────────
export interface INotificationService {
  /** Send a single reminder card. Returns true on success. */
  sendReminder(data: {
    type: ReminderType;
    payload: unknown;
  }): Promise<boolean>;

  /** Send multiple reminders in sequence. */
  sendBatch(
    reminders: Array<{ type: ReminderType; payload: unknown }>
  ): Promise<{ sent: number; failed: number }>;

  /** Verify that the configured webhook / channel is reachable. */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

// ── Expense service (Phase 8) ─────────────────────────────────────────────────
export interface IExpenseService {
  listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]>;
  getClaim(id: string): Promise<ExpenseClaim | null>;
  saveClaim(claim: ExpenseClaim): Promise<void>;
  deleteClaim(id: string, deletedBy?: string): Promise<void>;
  restoreClaim(id: string): Promise<void>;
  listDeletedClaims(): Promise<ExpenseClaim[]>;
  deleteAllClaims(): Promise<void>;
  updateStatus(id: string, status: ExpenseStatus, actorName: string, comment?: string): Promise<void>;
  validateClaim(claim: ExpenseClaim): Promise<ExpenseValidationResult>;
  // Aliases used by some routes / services
  listExpenses?(filters?: { status?: string; month?: string }): Promise<ExpenseClaim[]>;
  getExpense?(id: string): Promise<ExpenseClaim | null>;
  saveExpense?(claim: ExpenseClaim): Promise<void>;
  deleteExpense?(id: string): Promise<void>;
}

// ── Outbound invoice service (Phase 9) ────────────────────────────────────────
export interface IOutboundInvoiceService {
  listInvoices(filters?: { status?: OutboundInvoiceStatus; billingMonth?: string }): Promise<OutboundInvoice[]>;
  getInvoice(id: string): Promise<OutboundInvoice | null>;
  saveInvoice(invoice: OutboundInvoice): Promise<void>;
  deleteInvoice(id: string, deletedBy?: string): Promise<void>;
  restoreInvoice(id: string): Promise<void>;
  listDeletedInvoices(): Promise<OutboundInvoice[]>;
  updateStatus(id: string, status: OutboundInvoiceStatus, actorName: string): Promise<void>;
  getSummary(month?: string): Promise<OutboundInvoiceSummary>;
}

// ── Monthly close checklist service (Phase 10) ────────────────────────────────
export interface ICloseChecklistService {
  getChecklist(month: string): Promise<MonthlyCloseChecklist>;
  updateItem(id: string, updates: Partial<Pick<CloseChecklistItem, "status" | "assignee" | "completedBy" | "completedAt" | "notes">>): Promise<void>;
  resetChecklist(month: string): Promise<void>;
}

// ── Reminder service (Phase 7) ────────────────────────────────────────────────
export interface IReminderService {
  /** Detect vendors with active contracts who have not submitted for month. */
  detectGaps(month: string): Promise<ReminderGap[]>;

  /** Detect invoices stuck in a non-approved review status for N+ days. */
  detectStaleReviews(thresholdDays: number): Promise<StaleReview[]>;

  /** Detect invoices whose derived due date is within thresholdDays or past. */
  detectDueDateIssues(thresholdDays: number): Promise<DueDateAlert[]>;

  /** Run detection for the given type, send notifications, and log results. */
  sendReminders(
    month: string,
    type: ReminderType | "all"
  ): Promise<{ sent: number; failed: number; skipped: number }>;

  /** Return a combined summary for the dashboard widget. */
  getSummary(month: string): Promise<ReminderSummary>;

  /** Return recent reminder log entries for the month. */
  getLogs(month: string): Promise<ReminderLog[]>;
}

// ── Client service (Phase 11) ─────────────────────────────────────────────────
export interface IClientService {
  listClients(filters?: { status?: ClientStatus }): Promise<Client[]>;
  getClient(id: string): Promise<Client | null>;
  saveClient(client: Client): Promise<void>;
  deleteClient(id: string): Promise<void>;
}

// ── Lead service (Phase 11) ───────────────────────────────────────────────────
export interface ILeadService {
  listLeads(filters?: { stage?: LeadStage; assignedTo?: string; clientId?: string }): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  saveLead(lead: Lead): Promise<void>;
  deleteLead(id: string): Promise<void>;
  updateStage(id: string, stage: LeadStage, actorName: string): Promise<void>;
  getSummary(month?: string): Promise<LeadSummary>;
}

// ── Member service (Phase 11) ─────────────────────────────────────────────────
export interface IMemberService {
  listMembers(filters?: { status?: MemberStatus; role?: string }): Promise<Member[]>;
  getMember(id: string): Promise<Member | null>;
  saveMember(member: Member): Promise<void>;
  deleteMember(id: string): Promise<void>;
}

// ── Accounting service (Phase 11) ─────────────────────────────────────────────
export interface IAccountingService {
  listEntries(filters?: { month?: string; type?: AccountingEntryType; status?: AccountingEntryStatus; sourceType?: string }): Promise<AccountingEntry[]>;
  getEntry(id: string): Promise<AccountingEntry | null>;
  saveEntry(entry: AccountingEntry): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  postEntry(id: string, actorName: string): Promise<void>;
  voidEntry(id: string, actorName: string): Promise<void>;
  getProfitAndLoss(month: string): Promise<ProfitAndLoss>;
  getSummary(month: string): Promise<AccountingSummary>;
}

// ── Reporting service (Phase 11) ──────────────────────────────────────────────
export interface IReportingService {
  getKPIs(month: string): Promise<ReportingKPIs>;
}

// ── Outbound service (compact, used by mock/outboundService + real/SupabaseOutboundService) ──
export interface IOutboundService {
  listOutbound(filters?: { status?: string }): Promise<OutboundInvoice[]>;
  getOutbound(id: string): Promise<OutboundInvoice | null>;
  saveOutbound(invoice: OutboundInvoice): Promise<void>;
  deleteOutbound(id: string): Promise<void>;
}

// ── Close service (Phase 10 — lightweight checklist + bank sync) ──────────────
export interface ICloseService {
  getChecklist(month: string): Promise<MonthlyChecklistItem[]>;
  saveChecklistItem(item: MonthlyChecklistItem): Promise<void>;
  initChecklist(month: string): Promise<MonthlyChecklistItem[]>;
  getBankSyncStatus(): Promise<BankSyncStatus>;
}
