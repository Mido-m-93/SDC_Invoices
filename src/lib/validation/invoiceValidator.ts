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
  // 税抜 means "tax-excluded" — not a positive signal for tax being included.
  // Only match keywords that indicate tax IS present/applied.
  return /消費税|税込|tax|vat/i.test(text);
}

// ── Name matching ─────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.]/g, "");
}

function nameContainsMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
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

// ── Safe validator wrapper (Rule 9) ──────────────────────────────────────────
// Any unexpected error during validation must never crash the pipeline.
// Instead, mark the invoice REVIEW_REQUIRED so a human can inspect it.

export function safeValidationResult(
  submission: InvoiceSubmission,
  extracted: ExtractedInvoiceFields | null,
  pdfAccessible: boolean,
  duplicateDetected: boolean,
  config: AppConfig = DEFAULT_CONFIG
): InvoiceValidationResult {
  try {
    return buildValidationResult(submission, extracted, pdfAccessible, duplicateDetected, config);
  } catch (err) {
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
      statusCode: "REVIEW_REQUIRED",
      issues: ["VALIDATION_ERROR"],
      extractedFields: extracted,
      proposedFilename: buildFilename(config, {
        payerName: submission.payerName,
        originalFilename: "invoice.pdf",
        closingMonth: submission.closingMonth,
      }),
      targetFolderPath: `請求書/${buildMonthFolderName(submission.closingMonth, config)}`,
    };
  }
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

  // When the PDF was accessible but extraction returned all-null (API failed or unreadable PDF),
  // show a single clear error instead of misleading DATE_MISSING / TAX_MISSING / AMOUNT_MISMATCH.
  const extractionCompletelyFailed =
    pdfAccessible &&
    !!extracted &&
    extracted.total === null &&
    extracted.invoiceDate === null &&
    extracted.memberName === null &&
    (!extracted.rawText || extracted.rawText.length === 0);

  if (pdfAccessible && (!extracted || extractionCompletelyFailed)) {
    issues.push("PDF_PARSE_ERROR: Invoice PDF was downloaded but fields could not be extracted — review manually");
  }

  // Fields from extracted PDF (only meaningful when extraction produced usable data)
  const extractionUsable = !!extracted && !extractionCompletelyFailed;
  const invoiceDateFound  = extractionUsable ? !!extracted!.invoiceDate : false;
  const taxIncluded       = extractionUsable
    ? (extracted!.taxAmount !== null || detectTaxMentioned(extracted!.rawText))
    : false;
  const subtotalFound     = extractionUsable ? extracted!.subtotal !== null : false;
  const totalFound        = extractionUsable ? extracted!.total !== null : false;
  const amountConsistent  = extractionUsable
    ? checkAmountConsistency(extracted!.subtotal, extracted!.taxAmount, extracted!.total, config.amountToleranceAbsolute)
    : false;
  const amountMatchesSheet = extractionUsable
    ? checkAmountMatchesSheet(submission.claimedAmountTaxIncluded, extracted!.total, config.amountToleranceAbsolute)
    : false;

  // Check submitter name appears in the PDF.
  // Email payers: can't verify by name in raw text; skip and let memberName carry the check.
  // Extraction-failed: skip entirely — vacuously passing on empty rawText is misleading.
  const rawText  = extracted?.rawText ?? "";
  const rawLower = rawText.toLowerCase();
  const isEmailPayerName = submission.payerName.includes("@");

  let nameFoundInPdf = true; // default: pass (no false positives when we can't check)
  if (extractionUsable && !isEmailPayerName) {
    const nameParts = submission.payerName.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter((t) => t.length >= 3);

    // Accept if ANY significant token from the submitter name appears in raw text.
    // Requiring both first AND last name is too strict for multi-language invoices
    // where names may appear in a different order or partial form.
    const foundInRaw =
      rawText.length > 0 &&
      nameParts.length > 0 &&
      nameParts.some((t) => rawLower.includes(t));

    const foundInPayeeName =
      !!extracted!.memberName &&
      nameContainsMatch(extracted!.memberName, submission.payerName);

    nameFoundInPdf = foundInRaw || foundInPayeeName;
  }

  // Detect the "partial read" state: rawText was extracted but ALL structured fields are null.
  // In this case individual DATE_MISSING / TAX_MISSING / PAYEE_NAME_MISMATCH would all be
  // false-positives — the fields may exist in the PDF but the AI simply couldn't parse them.
  // Replace the noisy list with a single actionable warning.
  const allStructuredFieldsNull =
    extractionUsable &&
    extracted!.invoiceDate === null &&
    extracted!.subtotal === null &&
    extracted!.taxAmount === null &&
    extracted!.total === null &&
    extracted!.memberName === null;

  if (allStructuredFieldsNull) {
    issues.push(
      "PDF_FIELDS_UNREADABLE: Invoice text was read but date, amounts, and payee name could not be identified — please verify manually"
    );
  } else {
    if (!nameFoundInPdf && pdfAccessible && extractionUsable)
      issues.push(`PAYEE_NAME_MISMATCH: Submitter name "${submission.payerName}" not found in invoice PDF`);
    if (!invoiceDateFound && pdfAccessible && extractionUsable) issues.push("DATE_MISSING");
    if (!taxIncluded && pdfAccessible && extractionUsable) issues.push("TAX_MISSING");
    if (!amountMatchesSheet && pdfAccessible && extractionUsable && extracted!.total !== null)
      issues.push(`AMOUNT_MISMATCH: Form "${submission.claimedAmountTaxIncluded}" vs PDF total "${extracted!.total}"`);
  }

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
