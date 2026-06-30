import {
  parseCurrencyString,
  detectInvoiceDate,
  detectTaxMentioned,
  checkAmountConsistency,
  checkAmountMatchesSheet,
  buildValidationResult,
  safeValidationResult,
} from "@/lib/validation/invoiceValidator";
import { DEFAULT_CONFIG } from "@/config/defaults";
import type { InvoiceSubmission, ExtractedInvoiceFields } from "@/types";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const baseSubmission: InvoiceSubmission = {
  id: "sub-001",
  submissionRowNumber: 1,
  email: "contractor@example.com",
  payerName: "田中 太郎",
  closingMonth: "2026-05",
  invoiceAttachment: "https://drive.google.com/file/d/abc123",
  notes: "",
  internalDepartment: "開発部",
  externalProjectName: "",
  projectType: "業務委託",
  claimedAmountTaxIncluded: "330000",
  invoiceProjectStatus: "active",
  paymentStatus: "",
  paymentAmount: "",
  paymentProcessingStatus: "",
};

const goodExtracted: ExtractedInvoiceFields = {
  invoiceDate: "2026-05-31",
  subtotal: 300000,
  taxAmount: 30000,
  total: 330000,
  taxRate: 0.1,
  memberName: "田中 太郎",
  payerNameOnDoc: "SDC株式会社",
  rawText: "請求書 2026年5月31日 小計 300,000円 消費税 30,000円 合計 330,000円",
};

// ── parseCurrencyString ───────────────────────────────────────────────────────

describe("parseCurrencyString", () => {
  it("parses plain number string", () => {
    expect(parseCurrencyString("330000")).toBe(330000);
  });

  it("parses comma-separated Japanese number", () => {
    expect(parseCurrencyString("330,000")).toBe(330000);
  });

  it("strips yen symbol", () => {
    expect(parseCurrencyString("¥330,000")).toBe(330000);
  });

  it("strips 円 suffix", () => {
    expect(parseCurrencyString("330,000円")).toBe(330000);
  });

  it("parses decimal amounts", () => {
    expect(parseCurrencyString("330000.50")).toBe(330000.5);
  });

  it("returns null for empty string", () => {
    expect(parseCurrencyString("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseCurrencyString(null)).toBeNull();
    expect(parseCurrencyString(undefined)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseCurrencyString("N/A")).toBeNull();
  });
});

// ── detectInvoiceDate ─────────────────────────────────────────────────────────

describe("detectInvoiceDate", () => {
  it("detects ISO date format", () => {
    expect(detectInvoiceDate("Invoice date: 2026-05-31")).toBe("2026-05-31");
  });

  it("detects Japanese date format", () => {
    const result = detectInvoiceDate("請求書 2026年5月31日発行");
    expect(result).toContain("2026");
    expect(result).not.toBeNull();
  });

  it("detects slash-separated date", () => {
    expect(detectInvoiceDate("Date: 2026/05/31")).toBe("2026/05/31");
  });

  it("returns null when no date found", () => {
    expect(detectInvoiceDate("This invoice has no date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectInvoiceDate("")).toBeNull();
  });
});

// ── detectTaxMentioned ────────────────────────────────────────────────────────

describe("detectTaxMentioned", () => {
  it("detects 消費税", () => {
    expect(detectTaxMentioned("消費税 30,000円")).toBe(true);
  });

  it("detects 税込", () => {
    expect(detectTaxMentioned("税込330,000円")).toBe(true);
  });

  it("detects 税抜", () => {
    expect(detectTaxMentioned("税抜300,000円")).toBe(true);
  });

  it("detects English 'tax' case-insensitively", () => {
    expect(detectTaxMentioned("Total Tax: 30000")).toBe(true);
    expect(detectTaxMentioned("TAX: 30000")).toBe(true);
  });

  it("detects VAT", () => {
    expect(detectTaxMentioned("VAT: 30000")).toBe(true);
  });

  it("returns false when no tax mention", () => {
    expect(detectTaxMentioned("合計 330,000円")).toBe(false);
  });
});

// ── checkAmountConsistency ────────────────────────────────────────────────────

describe("checkAmountConsistency", () => {
  it("returns true when subtotal + tax = total within tolerance", () => {
    expect(checkAmountConsistency(300000, 30000, 330000, 1)).toBe(true);
  });

  it("returns true within tolerance", () => {
    expect(checkAmountConsistency(300000, 30000, 330001, 1)).toBe(true);
  });

  it("returns false when outside tolerance", () => {
    expect(checkAmountConsistency(300000, 30000, 330002, 1)).toBe(false);
  });

  it("handles null tax (treats as 0)", () => {
    expect(checkAmountConsistency(330000, null, 330000, 1)).toBe(true);
  });

  it("returns false when subtotal is null", () => {
    expect(checkAmountConsistency(null, 30000, 330000, 1)).toBe(false);
  });

  it("returns false when total is null", () => {
    expect(checkAmountConsistency(300000, 30000, null, 1)).toBe(false);
  });
});

// ── checkAmountMatchesSheet ───────────────────────────────────────────────────

describe("checkAmountMatchesSheet", () => {
  it("returns true when amounts match within tolerance", () => {
    expect(checkAmountMatchesSheet("330000", 330000, 1)).toBe(true);
  });

  it("returns true within tolerance", () => {
    expect(checkAmountMatchesSheet("330000", 330001, 1)).toBe(true);
  });

  it("returns false when outside tolerance", () => {
    expect(checkAmountMatchesSheet("330000", 330002, 1)).toBe(false);
  });

  it("returns false when invoiceTotal is null", () => {
    expect(checkAmountMatchesSheet("330000", null, 1)).toBe(false);
  });

  it("returns false when sheet value is non-numeric", () => {
    expect(checkAmountMatchesSheet("N/A", 330000, 1)).toBe(false);
  });

  it("parses formatted sheet amounts correctly", () => {
    expect(checkAmountMatchesSheet("¥330,000", 330000, 1)).toBe(true);
    expect(checkAmountMatchesSheet("330,000円", 330000, 1)).toBe(true);
  });
});

// ── buildValidationResult ─────────────────────────────────────────────────────

describe("buildValidationResult", () => {
  it("returns READY for a perfect invoice", () => {
    const result = buildValidationResult(
      baseSubmission, goodExtracted, true, false, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("READY");
    expect(result.issues).toHaveLength(0);
    expect(result.pdfAccessible).toBe(true);
    expect(result.invoiceDateFound).toBe(true);
    expect(result.taxIncluded).toBe(true);
    expect(result.amountMatchesSheet).toBe(true);
    expect(result.amountConsistent).toBe(true);
  });

  it("returns MISSING_ATTACHMENT when no attachment", () => {
    const sub = { ...baseSubmission, invoiceAttachment: "" };
    const result = buildValidationResult(sub, null, false, false, DEFAULT_CONFIG);
    expect(result.statusCode).toBe("MISSING_ATTACHMENT");
    expect(result.issues).toContain("MISSING_ATTACHMENT");
  });

  it("returns PDF_LINK_ERROR when PDF is inaccessible but link exists", () => {
    const result = buildValidationResult(
      baseSubmission, null, false, false, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("PDF_LINK_ERROR");
    expect(result.issues).toContain("PDF_LINK_ERROR");
  });

  it("returns ALREADY_PROCESSED when payment status matches completed", () => {
    const config = { ...DEFAULT_CONFIG, completedStatuses: ["支払済み"] };
    const sub = { ...baseSubmission, paymentProcessingStatus: "支払済み" };
    const result = buildValidationResult(sub, goodExtracted, true, false, config);
    expect(result.statusCode).toBe("ALREADY_PROCESSED");
    expect(result.issues).toHaveLength(0);
  });

  it("returns DUPLICATE_FILE when duplicate is detected", () => {
    const result = buildValidationResult(
      baseSubmission, goodExtracted, true, true, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("DUPLICATE_FILE");
    expect(result.issues).toContain("DUPLICATE_FILE");
  });

  it("returns REVIEW_REQUIRED when amount does not match sheet", () => {
    const extracted = { ...goodExtracted, total: 999999 };
    const result = buildValidationResult(
      baseSubmission, extracted, true, false, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("REVIEW_REQUIRED");
    expect(result.issues).toContain("AMOUNT_MISMATCH");
  });

  it("returns REVIEW_REQUIRED when date is missing from PDF", () => {
    const extracted = { ...goodExtracted, invoiceDate: null };
    const result = buildValidationResult(
      baseSubmission, extracted, true, false, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("REVIEW_REQUIRED");
    expect(result.issues).toContain("DATE_MISSING");
  });

  it("returns REVIEW_REQUIRED when project info is missing", () => {
    const sub = { ...baseSubmission, internalDepartment: "", externalProjectName: "" };
    const result = buildValidationResult(sub, goodExtracted, true, false, DEFAULT_CONFIG);
    expect(result.statusCode).toBe("REVIEW_REQUIRED");
    expect(result.issues).toContain("PROJECT_INFO_MISSING");
  });

  it("builds the proposed filename from config template", () => {
    const result = buildValidationResult(
      baseSubmission, goodExtracted, true, false, DEFAULT_CONFIG
    );
    expect(result.proposedFilename).toContain("田中 太郎");
    expect(result.proposedFilename).toMatch(/\.pdf$/);
  });

  it("builds the target folder path from closing month", () => {
    const result = buildValidationResult(
      baseSubmission, goodExtracted, true, false, DEFAULT_CONFIG
    );
    expect(result.targetFolderPath).toContain("請求書");
    expect(result.targetFolderPath).toContain("2026");
  });
});

// ── safeValidationResult ──────────────────────────────────────────────────────

describe("safeValidationResult", () => {
  it("returns a valid result for a good invoice", () => {
    const result = safeValidationResult(
      baseSubmission, goodExtracted, true, false, DEFAULT_CONFIG
    );
    expect(result.statusCode).toBe("READY");
  });

  it("returns REVIEW_REQUIRED instead of throwing on unexpected error", () => {
    // Force an error by passing an extracted object that throws during processing
    const brokenExtracted = { get total() { throw new Error("parse error"); } } as unknown as ExtractedInvoiceFields;
    const result = safeValidationResult(baseSubmission, brokenExtracted, true, false, DEFAULT_CONFIG);
    expect(result.statusCode).toBe("REVIEW_REQUIRED");
    expect(result.issues).toContain("VALIDATION_ERROR");
  });
});
