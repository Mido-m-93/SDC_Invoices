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
