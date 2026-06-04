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
  ReminderType,
  ReminderLog,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ReminderSummary,
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
export interface IDriveService {
  /**
   * Fetch the raw bytes (or metadata) of an attachment by its URL.
   */
  fetchAttachment(
    url: string
  ): Promise<{ filename: string; mimeType: string; data: Uint8Array } | null>;

  /**
   * Upload a PDF to the target Drive folder with the given filename.
   * Returns the Drive file ID and web view link.
   */
  uploadPdf(params: {
    folderId: string;
    filename: string;
    data: Uint8Array;
  }): Promise<{ fileId: string; webViewLink: string }>;

  /**
   * Ensure a monthly subfolder exists under the root folder.
   * Returns the folder ID.
   */
  ensureMonthFolder(params: {
    rootFolderId: string;
    folderName: string;
  }): Promise<string>;

  /**
   * Check if a file with the given name already exists in the folder.
   */
  checkDuplicate(params: {
    folderId: string;
    filename: string;
  }): Promise<boolean>;
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

  /** Load saved submissions for a given month */
  loadSubmissionsFromStore(month: string): Promise<InvoiceSubmission[]>;

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
