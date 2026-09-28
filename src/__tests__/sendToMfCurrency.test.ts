// ─────────────────────────────────────────────────────────────────────────────
// __tests__/sendToMfCurrency.test.ts
//
// Integration tests for POST /api/invoices/send-to-mf
// (src/app/api/invoices/send-to-mf/route.ts), focused on the currency-source
// fix under review: the route must prefer the currency detected from the
// invoice PDF's own text (validation.extractedFields.currency) over a guess
// made from the form's free-text amount string, and only fall back to that
// guess when no extracted currency is available at all.
//
// Strategy (Robo Co-op principle: no mock abuse):
//   - "next/server", "next/headers", "server-only", "@supabase/ssr" are
//     mocked because they're Next.js/Supabase runtime modules unavailable in
//     plain Jest (same pattern as authGuard.test.ts). requireAuth() itself
//     takes its real dev-bypass branch (no Supabase env vars set in tests),
//     so no auth logic is faked beyond making the modules importable.
//   - MoneyForwardService (real external API) and convertUsdToJpy (real HTTP
//     FX lookup) are boundaries — mocked at the module level.
//   - getStorageService (Supabase persistence) is a boundary — mocked with a
//     minimal in-memory-ish fake.
//   - deriveDueDate is a pure function — NOT mocked, runs for real.
//   - The currency-preference expression itself
//     (`validation.extractedFields?.currency ?? detectCurrency(...)`) and
//     amount/date parsing run unmocked — that's exactly what's under test.
//
// What is NOT tested here:
//   - The Money Forward OAuth/token-refresh internals of MoneyForwardService
//     (separate unit, own boundary).
//   - The exchange-rate HTTP call itself (ExchangeRateService's own
//     boundary/failure modes) — only that the route calls it when (and only
//     when) the resolved currency is USD.
//   - Storage-write failure handling (the route already swallows this and
//     logs a warning; not currency-related).
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("server-only", () => ({}));

jest.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [] }),
}));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

const sendInvoice = jest.fn();
jest.mock("@/lib/services/real/MoneyForwardService", () => ({
  MoneyForwardService: jest.fn().mockImplementation(() => ({ sendInvoice })),
}));

const convertUsdToJpy = jest.fn();
jest.mock("@/lib/services/real/ExchangeRateService", () => ({
  convertUsdToJpy: (...args: unknown[]) => convertUsdToJpy(...args),
}));

const loadValidationResults = jest.fn();
const saveValidationResult = jest.fn();
jest.mock("@/lib/services", () => ({
  getStorageService: () => ({ loadValidationResults, saveValidationResult }),
}));

// Import AFTER jest.mock so the mocks are in place.
import { POST } from "@/app/api/invoices/send-to-mf/route";
import type { InvoiceSubmission, InvoiceValidationResult, ExtractedInvoiceFields } from "@/types";

function makeSubmission(overrides: Partial<InvoiceSubmission> = {}): InvoiceSubmission {
  return {
    id: "sub-1",
    submissionRowNumber: 1,
    email: "carol@sdc.co.jp",
    payerName: "Carol Smith",
    closingMonth: "2026-05",
    invoiceAttachment: "https://drive.google.com/file/x",
    notes: "",
    internalDepartment: "",
    externalProjectName: "",
    projectType: "",
    claimedAmountTaxIncluded: "100,000", // no symbol at all — ambiguous / defaults to JPY
    invoiceProjectStatus: "",
    paymentStatus: "",
    paymentAmount: "",
    paymentProcessingStatus: "",
    ...overrides,
  };
}

function makeExtractedFields(overrides: Partial<ExtractedInvoiceFields> = {}): ExtractedInvoiceFields {
  return {
    invoiceDate: "2026-05-01",
    subtotal: 100000,
    taxAmount: 0,
    total: 100000,
    taxRate: null,
    memberName: "Carol Smith",
    payerNameOnDoc: "SDC",
    rawText: "",
    currency: "JPY",
    ...overrides,
  };
}

function makeValidation(extractedFields: ExtractedInvoiceFields | null): InvoiceValidationResult {
  return {
    submissionId: "sub-1",
    pdfAccessible: true,
    invoiceDateFound: true,
    taxIncluded: true,
    subtotalFound: true,
    totalFound: true,
    amountConsistent: true,
    amountMatchesSheet: true,
    duplicateDetected: false,
    statusCode: "OK",
    issues: [],
    extractedFields,
    proposedFilename: "invoice.pdf",
    targetFolderPath: "/invoices",
  } as InvoiceValidationResult;
}

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  sendInvoice.mockResolvedValue({ billingId: "bill-1", billingUrl: "https://mf.example/bill-1" });
  convertUsdToJpy.mockResolvedValue({ amountJpy: 15000, rate: 150, asOf: "2026-05-01" });
  loadValidationResults.mockResolvedValue([]); // no existing record — storage write is skipped
});

describe("POST /api/invoices/send-to-mf — currency source", () => {
  it("prefers the PDF-extracted currency over the form string, even when the form string would guess wrong", async () => {
    // Form amount has no currency marker at all (detectCurrency would default
    // to JPY), but the PDF itself was in USD — extractedFields.currency must win.
    const submission = makeSubmission({ claimedAmountTaxIncluded: "100" });
    const validation = makeValidation(makeExtractedFields({ currency: "USD" }));

    await POST(makeRequest({ submission, validation }));

    expect(convertUsdToJpy).toHaveBeenCalledTimes(1);
    expect(sendInvoice).toHaveBeenCalledTimes(1);
    const call = sendInvoice.mock.calls[0][0];
    expect(call.amount).toBe(15000); // converted, not the raw 100
    expect(call.memo).toContain("Converted from $100.00");
  });

  it("does not convert when the PDF-extracted currency is JPY, even if the form string looks like USD", async () => {
    // This is the bug the fix addresses: previously the route guessed
    // currency from this very string and would have misdetected USD here.
    const submission = makeSubmission({ claimedAmountTaxIncluded: "$100" });
    const validation = makeValidation(makeExtractedFields({ currency: "JPY" }));

    await POST(makeRequest({ submission, validation }));

    expect(convertUsdToJpy).not.toHaveBeenCalled();
    expect(sendInvoice).toHaveBeenCalledTimes(1);
    expect(sendInvoice.mock.calls[0][0].amount).toBe(100);
  });

  it("falls back to detecting currency from the form string when no extracted fields are present", async () => {
    const submission = makeSubmission({ claimedAmountTaxIncluded: "$100" });
    const validation = makeValidation(null);

    await POST(makeRequest({ submission, validation }));

    expect(convertUsdToJpy).toHaveBeenCalledTimes(1);
    expect(sendInvoice.mock.calls[0][0].amount).toBe(15000);
  });
});
