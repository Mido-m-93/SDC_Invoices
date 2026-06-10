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
  IVendorService,
  IContractService,
} from "../types";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  ExtractedInvoiceFields,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  AppConfig,
  Vendor,
  Contract,
} from "@/types";
import { safeValidationResult, parseCurrencyString } from "@/lib/validation/invoiceValidator";
import {
  loadUploadedSubmissions,
  saveUploadedSubmissions,
  saveValidationResult,
  loadValidationResults,
  saveFiledDocument,
  loadFiledDocuments,
  saveRun,
  loadRuns,
  appendLog,
  loadLogs,
  loadVendors,
  saveVendor,
  deleteVendor,
  loadContracts,
  saveContract,
  deleteContract,
} from "./fileStore";
import { DEFAULT_CONFIG } from "@/config/defaults";

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// ── Mock Sheets Service ───────────────────────────────────────────────────────
export class MockSheetsService implements ISheetsService {
  async loadSubmissions(month: string): Promise<InvoiceSubmission[]> {
    await delay(300);
    return loadUploadedSubmissions(month);
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
  async validate(submission: InvoiceSubmission): Promise<InvoiceValidationResult> {
    await delay(500);

    if (!submission.invoiceAttachment) {
      const base = safeValidationResult(submission, null, false, false);
      return enrichWithRisk(base, submission);
    }

    const claimedTotal = parseCurrencyString(submission.claimedAmountTaxIncluded) ?? 100000;
    const subtotal = Math.round(claimedTotal / 1.1);
    const taxAmount = claimedTotal - subtotal;

    // Normalize closingMonth to YYYY-MM regardless of input format (ISO or Japanese)
    const jpMatch = submission.closingMonth?.match(/(\d{4})年\s*(\d{1,2})月/);
    const isoMonth = jpMatch
      ? `${jpMatch[1]}-${jpMatch[2].padStart(2, "0")}`
      : submission.closingMonth?.slice(0, 7);

    const mockExtracted: ExtractedInvoiceFields = {
      invoiceDate: isoMonth ? `${isoMonth}-01` : "2024-01-01",
      subtotal,
      taxAmount,
      total: claimedTotal,
      taxRate: 0.1,
      payeeName: submission.payerName,
      payerNameOnDoc: null,
      rawText: "消費税",
    };

    const base = safeValidationResult(submission, mockExtracted, true, false);
    return enrichWithRisk(base, submission);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function enrichWithRisk(
  result: InvoiceValidationResult,
  submission: InvoiceSubmission
): InvoiceValidationResult {
  const vendors = loadVendors();
  const contracts = loadContracts();
  const payerNorm = normalizeForMatch(submission.payerName);

  const vendor = vendors.find(
    (v) =>
      v.status === "active" &&
      [v.name, ...v.aliases].some((n) => normalizeForMatch(n) === payerNorm)
  );

  const vendorMatched = !!vendor;
  let contractMatched = false;
  let contractId: string | undefined;
  let activeContract: Contract | undefined;

  if (vendor) {
    const today = new Date().toISOString().slice(0, 10);
    activeContract = contracts.find(
      (c) =>
        c.vendorId === vendor.id &&
        c.status === "active" &&
        c.startDate <= today &&
        c.endDate >= today
    );
    contractMatched = !!activeContract;
    contractId = activeContract?.id;
  }

  // Risk scoring
  let riskLevel: import("@/types").RiskLevel;
  let reviewerRecommendation: string;

  if (vendorMatched && !contractMatched) {
    // Known vendor but no active contract — blocked
    riskLevel = "BLOCKED";
    reviewerRecommendation = vendor!.defaultReviewer || "Accounting Lead";
  } else if (!vendorMatched) {
    // Unknown vendor — needs review
    riskLevel = "NEEDS_REVIEW";
    reviewerRecommendation = "Accounting Lead";
  } else if (
    activeContract &&
    submission.claimedAmountTaxIncluded &&
    activeContract.expectedMonthlyAmount > 0
  ) {
    const claimed = parseCurrencyString(submission.claimedAmountTaxIncluded) ?? 0;
    const tolerance = activeContract.expectedMonthlyAmount * 0.1; // 10% tolerance
    if (Math.abs(claimed - activeContract.expectedMonthlyAmount) > tolerance) {
      riskLevel = "NEEDS_REVIEW";
      reviewerRecommendation = vendor!.defaultReviewer || "Accounting Lead";
    } else {
      riskLevel = result.statusCode === "READY" ? "OK" : "NEEDS_REVIEW";
      reviewerRecommendation = vendor!.defaultReviewer || "Accounting";
    }
  } else {
    riskLevel = result.statusCode === "READY" ? "OK" : "NEEDS_REVIEW";
    reviewerRecommendation = vendor?.defaultReviewer || "Accounting";
  }

  return { ...result, vendorMatched, contractMatched, contractId, riskLevel, reviewerRecommendation };
}

// ── Mock Storage Service ──────────────────────────────────────────────────────
export class MockStorageService implements IStorageService {
  private config: AppConfig = { ...DEFAULT_CONFIG };

  async saveSubmissions(submissions: InvoiceSubmission[], month: string): Promise<void> {
    saveUploadedSubmissions(submissions, month);
  }

  async loadSubmissionsFromStore(month: string): Promise<InvoiceSubmission[]> {
    return loadUploadedSubmissions(month);
  }

  async listAvailableMonths(): Promise<string[]> {
    const all = loadUploadedSubmissions();
    const seen = new Set<string>();
    for (const s of all) {
      const m = s.closingMonth?.match(/(\d{4})[^\d](\d{1,2})/);
      if (m) seen.add(`${m[1]}-${m[2].padStart(2, "0")}`);
    }
    return Array.from(seen).sort().reverse();
  }

  async saveValidationResult(result: InvoiceValidationResult): Promise<void> {
    saveValidationResult(result);
  }

  async saveFiledDocument(doc: FiledDocument): Promise<void> {
    saveFiledDocument(doc);
  }

  async loadValidationResults(submissionIds: string[]): Promise<InvoiceValidationResult[]> {
    return loadValidationResults(submissionIds);
  }

  async loadFiledDocuments(submissionIds: string[]): Promise<FiledDocument[]> {
    return loadFiledDocuments(submissionIds);
  }

  async loadRuns(): Promise<ProcessingRun[]> {
    return loadRuns();
  }

  async saveRun(run: ProcessingRun): Promise<void> {
    saveRun(run);
  }

  async appendLog(log: ProcessingLog): Promise<void> {
    appendLog(log);
  }

  async loadLogs(runId: string): Promise<ProcessingLog[]> {
    return loadLogs(runId);
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
    await delay(300);
    const submissions = loadUploadedSubmissions(month);
    return {
      selectedMonth: month,
      totalRows: submissions.length,
      ready: 0,
      reviewRequired: 0,
      saved: 0,
      errors: 0,
      missingAttachment: submissions.filter((s) => !s.invoiceAttachment).length,
      alreadyProcessed: 0,
    };
  }
}

// ── Mock Vendor Service ───────────────────────────────────────────────────────
export class MockVendorService implements IVendorService {
  async listVendors(): Promise<Vendor[]> {
    return loadVendors();
  }
  async saveVendor(vendor: Vendor): Promise<void> {
    saveVendor(vendor);
  }
  async deleteVendor(id: string): Promise<void> {
    deleteVendor(id);
  }
}

// ── Mock Contract Service ─────────────────────────────────────────────────────
export class MockContractService implements IContractService {
  async listContracts(): Promise<Contract[]> {
    return loadContracts();
  }
  async saveContract(contract: Contract): Promise<void> {
    saveContract(contract);
  }
  async deleteContract(id: string): Promise<void> {
    deleteContract(id);
  }
}
