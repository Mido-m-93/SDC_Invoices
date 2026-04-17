// ─────────────────────────────────────────────────────────────────────────────
// lib/validation/invoiceValidator.ts — Core validation logic
//
// Phase 1: validates fields extracted from invoice text.
// Phase 2: add real PDF parsing here (pdf-parse, Google Document AI, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  InvoiceStatusCode,
  ExtractedInvoiceFields,
} from "@/types";
import type { AppConfig } from "@/types";
import { DEFAULT_CONFIG, buildFilename, buildMonthFolderName } from "@/config/defaults";

// ── Amount parsing ────────────────────────────────────────────────────────────

/**
 * Parse a Japanese/numeric currency string to a number.
 * Handles: "330,000", "330000", "¥330,000", "330,000円", "330000.00"
 */
export function parseCurrencyString(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[¥￥,、\s円]/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── Date detection ────────────────────────────────────────────────────────────

/**
 * Detect whether invoice text contains a plausible date.
 * Returns found date string or null.
 */
export function detectInvoiceDate(text: string): string | null {
  // ISO: 2024-03-31
  const isoMatch = text.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/);
  if (isoMatch) return isoMatch[1];

  // Japanese: 2024年3月31日 or 令和6年3月31日
  const jpMatch = text.match(/(\d{4}|令和\d+|平成\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jpMatch) return jpMatch[0];

  return null;
}

// ── Tax detection ─────────────────────────────────────────────────────────────

/**
 * Detect whether the invoice mentions tax (消費税 / 税).
 */
export function detectTaxMentioned(text: string): boolean {
  return /消費税|税込|税抜|tax|vat/i.test(text);
}

// ── Amount consistency ────────────────────────────────────────────────────────

/**
 * Check subtotal + tax ≈ total, within tolerance.
 */
export function checkAmountConsistency(
  subtotal: number | null,
  tax: number | null,
  total: number | null,
  tolerance: number
): boolean {
  if (subtotal === null || total === null) return false;
  const expected = subtotal + (tax ?? 0);
  return Math.abs(expected - total) <= tolerance;
}

/**
 * Check invoice total ≈ sheet claimed amount.
 */
export function checkAmountMatchesSheet(
  sheetRaw: string,
  invoiceTotal: number | null,
  tolerance: number
): boolean {
  if (invoiceTotal === null) return false;
  const sheetAmount = parseCurrencyString(sheetRaw);
  if (sheetAmount === null) return false;
  return Math.abs(sheetAmount - invoiceTotal) <= tolerance;
}

// ── Main validator ────────────────────────────────────────────────────────────

export function buildValidationResult(
  submission: InvoiceSubmission,
  extracted: ExtractedInvoiceFields | null,
  pdfAccessible: boolean,
  duplicateDetected: boolean,
  config: AppConfig = DEFAULT_CONFIG
): InvoiceValidationResult {
  const issues: string[] = [];

  // Already processed?
  if (config.completedStatuses.includes(submission.paymentProcessingStatus)) {
    return {
      submissionId: submission.id,
      pdfAccessible,
      invoiceDateFound: false,
      taxIncluded: false,
      subtotalFound: false,
      totalFound: false,
      amountConsistent: false,
      amountMatchesSheet: false,
      duplicateDetected,
      statusCode: "ALREADY_PROCESSED",
      issues: [],
      extractedFields: extracted,
      proposedFilename: buildProposedFilename(submission, "invoice.pdf", config),
      targetFolderPath: buildTargetPath(submission, config),
    };
  }

  // Missing attachment
  if (!submission.invoiceAttachment) {
    issues.push("MISSING_ATTACHMENT");
  }

  // PDF not accessible
  if (!pdfAccessible && submission.invoiceAttachment) {
    issues.push("PDF_LINK_ERROR");
  }

  // Project info missing
  const hasProjectInfo =
    submission.internalDepartment || submission.externalProjectName;
  if (!hasProjectInfo) {
    issues.push("PROJECT_INFO_MISSING");
  }

  // Fields from extracted PDF
  const invoiceDateFound = extracted
    ? !!extracted.invoiceDate
    : false;
  const taxIncluded = extracted
    ? (extracted.taxAmount !== null || detectTaxMentioned(extracted.rawText))
    : false;
  const subtotalFound = extracted ? extracted.subtotal !== null : false;
  const totalFound = extracted ? extracted.total !== null : false;
  const amountConsistent = extracted
    ? checkAmountConsistency(
        extracted.subtotal,
        extracted.taxAmount,
        extracted.total,
        config.amountToleranceAbsolute
      )
    : false;
  const amountMatchesSheet = extracted
    ? checkAmountMatchesSheet(
        submission.claimedAmountTaxIncluded,
        extracted.total,
        config.amountToleranceAbsolute
      )
    : false;

  if (!invoiceDateFound && pdfAccessible) issues.push("DATE_MISSING");
  if (!taxIncluded && pdfAccessible) issues.push("TAX_MISSING");
  if (!amountMatchesSheet && pdfAccessible && extracted?.total !== null)
    issues.push("AMOUNT_MISMATCH");
  if (duplicateDetected) issues.push("DUPLICATE_FILE");

  // Determine final status code
  const statusCode = deriveStatusCode(issues, pdfAccessible, submission);

  const originalFilename =
    extracted ? "invoice.pdf" : "unknown.pdf";

  return {
    submissionId: submission.id,
    pdfAccessible,
    invoiceDateFound,
    taxIncluded,
    subtotalFound,
    totalFound,
    amountConsistent,
    amountMatchesSheet,
    duplicateDetected,
    statusCode,
    issues,
    extractedFields: extracted,
    proposedFilename: buildProposedFilename(submission, originalFilename, config),
    targetFolderPath: buildTargetPath(submission, config),
  };
}

function deriveStatusCode(
  issues: string[],
  pdfAccessible: boolean,
  submission: InvoiceSubmission
): InvoiceStatusCode {
  if (issues.includes("MISSING_ATTACHMENT")) return "MISSING_ATTACHMENT";
  if (issues.includes("PDF_LINK_ERROR")) return "PDF_LINK_ERROR";
  if (issues.includes("DUPLICATE_FILE")) return "DUPLICATE_FILE";
  if (issues.length > 0) return "REVIEW_REQUIRED";
  if (!pdfAccessible) return "REVIEW_REQUIRED";
  return "READY";
}

function buildProposedFilename(
  submission: InvoiceSubmission,
  originalFilename: string,
  config: AppConfig
): string {
  return buildFilename(config, {
    payerName: submission.payerName,
    originalFilename,
    closingMonth: submission.closingMonth,
  });
}

function buildTargetPath(
  submission: InvoiceSubmission,
  config: AppConfig
): string {
  const folderName = buildMonthFolderName(submission.closingMonth, config);
  return `請求書/${folderName}`;
}
