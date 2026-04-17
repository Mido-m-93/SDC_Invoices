// ─────────────────────────────────────────────────────────────────────────────
// lib/services/mock/index.ts — Mock service implementations
//
// All services return realistic data instantly.
// Replace with real implementations (lib/services/real/) when ready.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ISheetsService,
  IDriveService,
  IValidationService,
  IStorageService,
  IDashboardService,
} from "../types";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  AppConfig,
} from "@/types";
import {
  MOCK_SUBMISSIONS,
  MOCK_VALIDATION_RESULTS,
  MOCK_FILED_DOCUMENTS,
  MOCK_RUNS,
  MOCK_LOGS,
  getMockDashboardStats,
} from "./mockData";
import { DEFAULT_CONFIG } from "@/config/defaults";

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// ── Mock Sheets Service ───────────────────────────────────────────────────────
export class MockSheetsService implements ISheetsService {
  async loadSubmissions(_month: string): Promise<InvoiceSubmission[]> {
    await delay(800);
    // In mock mode, ignore month and return all sample submissions
    return [...MOCK_SUBMISSIONS];
  }
}

// ── Mock Drive Service ────────────────────────────────────────────────────────
export class MockDriveService implements IDriveService {
  async fetchAttachment(
    url: string
  ): Promise<{ filename: string; mimeType: string; data: Uint8Array } | null> {
    await delay(400);
    if (!url) return null;
    // Return a tiny fake PDF buffer
    return {
      filename: "mock_invoice.pdf",
      mimeType: "application/pdf",
      data: new Uint8Array([37, 80, 68, 70]), // "%PDF" magic bytes
    };
  }

  async uploadPdf(params: {
    folderId: string;
    filename: string;
    data: Uint8Array;
  }): Promise<{ fileId: string; webViewLink: string }> {
    await delay(700);
    const fileId = `mock-file-${Date.now()}`;
    return {
      fileId,
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
    };
  }

  async ensureMonthFolder(params: {
    rootFolderId: string;
    folderName: string;
  }): Promise<string> {
    await delay(200);
    return `mock-folder-${params.folderName}`;
  }

  async checkDuplicate(params: {
    folderId: string;
    filename: string;
  }): Promise<boolean> {
    await delay(100);
    // Simulate: the filed document for sub-005 already exists
    return params.filename.startsWith("中村 美咲_");
  }
}

// ── Mock Validation Service ───────────────────────────────────────────────────
export class MockValidationService implements IValidationService {
  async validate(
    submission: InvoiceSubmission
  ): Promise<InvoiceValidationResult> {
    await delay(500);
    const result = MOCK_VALIDATION_RESULTS[submission.id];
    if (result) return result;

    // Fallback for any submission not in mock data
    return {
      submissionId: submission.id,
      pdfAccessible: false,
      invoiceDateFound: false,
      taxIncluded: false,
      subtotalFound: false,
      totalFound: false,
      amountConsistent: false,
      amountMatchesSheet: false,
      duplicateDetected: false,
      statusCode: "REVIEW_REQUIRED",
      issues: ["REVIEW_REQUIRED"],
      extractedFields: null,
      proposedFilename: `${submission.payerName}_invoice.pdf`,
      targetFolderPath: `請求書/${submission.closingMonth}`,
    };
  }

  async validateBatch(
    submissions: InvoiceSubmission[]
  ): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}

// ── Mock Storage Service ──────────────────────────────────────────────────────
export class MockStorageService implements IStorageService {
  // In-memory store for mock state
  private validationResults = new Map<string, InvoiceValidationResult>(
    Object.entries(MOCK_VALIDATION_RESULTS)
  );
  private filedDocuments = new Map<string, FiledDocument>(
    Object.entries(MOCK_FILED_DOCUMENTS)
  );
  private runs: ProcessingRun[] = [...MOCK_RUNS];
  private logs: ProcessingLog[] = [...MOCK_LOGS];
  private config: AppConfig = { ...DEFAULT_CONFIG };

  async saveValidationResult(result: InvoiceValidationResult): Promise<void> {
    await delay(100);
    this.validationResults.set(result.submissionId, result);
  }

  async saveFiledDocument(doc: FiledDocument): Promise<void> {
    await delay(100);
    this.filedDocuments.set(doc.submissionId, doc);
  }

  async loadValidationResults(
    submissionIds: string[]
  ): Promise<InvoiceValidationResult[]> {
    await delay(200);
    return submissionIds
      .map((id) => this.validationResults.get(id))
      .filter(Boolean) as InvoiceValidationResult[];
  }

  async loadFiledDocuments(submissionIds: string[]): Promise<FiledDocument[]> {
    await delay(200);
    return submissionIds
      .map((id) => this.filedDocuments.get(id))
      .filter(Boolean) as FiledDocument[];
  }

  async loadRuns(): Promise<ProcessingRun[]> {
    await delay(200);
    return [...this.runs];
  }

  async saveRun(run: ProcessingRun): Promise<void> {
    await delay(100);
    const idx = this.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) this.runs[idx] = run;
    else this.runs.unshift(run);
  }

  async appendLog(log: ProcessingLog): Promise<void> {
    await delay(50);
    this.logs.push(log);
  }

  async loadLogs(runId: string): Promise<ProcessingLog[]> {
    await delay(200);
    return this.logs.filter((l) => l.runId === runId);
  }

  async loadConfig(): Promise<AppConfig> {
    await delay(100);
    return { ...this.config };
  }

  async saveConfig(config: AppConfig): Promise<void> {
    await delay(100);
    this.config = { ...config };
  }
}

// ── Mock Dashboard Service ────────────────────────────────────────────────────
export class MockDashboardService implements IDashboardService {
  async getStats(month: string) {
    await delay(400);
    return getMockDashboardStats(month);
  }
}
