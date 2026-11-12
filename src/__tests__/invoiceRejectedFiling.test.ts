// A reviewer-rejected invoice must never be filed to Drive, by either filing
// route, even when the validation in the request is stale (e.g. a second tab
// that still shows the invoice as Ready). Next runtime modules, the auth guard,
// the service layer and the PDF downloader are mocked.

jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: unknown) => ({ body, init }) },
}));
jest.mock("@/lib/auth-guard", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/services", () => ({ getDriveService: jest.fn(), getStorageService: jest.fn() }));
jest.mock("@/lib/services/real/RealValidationService", () => ({ fetchPdfBytes: jest.fn() }));

import { POST as fileInvoice } from "@/app/api/invoices/file/route";
import { POST as fileInvoiceBulk } from "@/app/api/invoices/file/bulk/route";
import { requireAuth } from "@/lib/auth-guard";
import { getDriveService, getStorageService } from "@/lib/services";
import { fetchPdfBytes } from "@/lib/services/real/RealValidationService";

type Res = { body: Record<string, unknown>; init?: { status?: number } };

const ensureMonthFolder = jest.fn();
const checkDuplicate = jest.fn();
const uploadPdf = jest.fn();
const loadValidationResults = jest.fn();
const loadConfig = jest.fn();
const saveFiledDocument = jest.fn();

const validation = (over = {}) => ({
  submissionId: "s1", statusCode: "READY", proposedFilename: "2026-09_A.pdf", targetFolderPath: "Invoices/2026/09", ...over,
});
const submission = (id = "s1") => ({ id, invoiceAttachment: "https://example.com/a.pdf" });
const req = (body: unknown) => ({ json: async () => body }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({ user: { id: "u" }, response: null });
  (getDriveService as jest.Mock).mockReturnValue({ ensureMonthFolder, checkDuplicate, uploadPdf });
  (getStorageService as jest.Mock).mockReturnValue({ loadValidationResults, loadConfig, saveFiledDocument });
  ensureMonthFolder.mockResolvedValue("folder-1");
  checkDuplicate.mockResolvedValue(false);
  uploadPdf.mockResolvedValue({ fileId: "drive-1", webViewLink: "https://drive/1" });
  loadValidationResults.mockResolvedValue([]);
  loadConfig.mockResolvedValue({});
  (fetchPdfBytes as jest.Mock).mockResolvedValue({ ok: true, data: new Uint8Array([1, 2, 3]) });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/invoices/file", () => {
  const call = (body: unknown) => fileInvoice(req(body)) as unknown as Promise<Res>;

  it("files a normal Ready invoice", async () => {
    const res = await call({ validation: validation(), submission: submission() });
    expect(res.init?.status).toBeUndefined();
    expect(res.body.success).toBe(true);
    expect(uploadPdf).toHaveBeenCalled();
    expect(saveFiledDocument).toHaveBeenCalled();
  });

  it("refuses (409) when the request's validation says rejected, and touches nothing", async () => {
    const res = await call({ validation: validation({ humanRejected: true }), submission: submission() });
    expect(res.init?.status).toBe(409);
    expect(ensureMonthFolder).not.toHaveBeenCalled();
    expect(uploadPdf).not.toHaveBeenCalled();
    expect(saveFiledDocument).not.toHaveBeenCalled();
  });

  it("refuses (409) when the stored validation is rejected but the request is stale", async () => {
    loadValidationResults.mockResolvedValue([validation({ humanRejected: true })]);
    const res = await call({ validation: validation(), submission: submission() });
    expect(res.init?.status).toBe(409);
    expect(uploadPdf).not.toHaveBeenCalled();
    expect(saveFiledDocument).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices/file/bulk", () => {
  const call = (body: unknown) => fileInvoiceBulk(req(body)) as unknown as Promise<Res>;

  it("skips rejected invoices (request or stored) and still files the others", async () => {
    loadValidationResults.mockResolvedValue([validation({ submissionId: "s3", humanRejected: true })]);
    const res = await call({
      validations: [validation({ submissionId: "s1" }), validation({ submissionId: "s2", humanRejected: true }), validation({ submissionId: "s3" })],
      submissions: [submission("s1"), submission("s2"), submission("s3")],
    });
    const body = res.body as { filed: Array<{ submissionId: string }>; skipped: Array<{ submissionId: string; reason: string }> };
    expect(body.filed.map((f) => f.submissionId)).toEqual(["s1"]);
    expect(body.skipped.map((s) => [s.submissionId, s.reason])).toEqual([
      ["s2", "Rejected by a reviewer"],
      ["s3", "Rejected by a reviewer"],
    ]);
    expect(uploadPdf).toHaveBeenCalledTimes(1);
  });

  it("still skips non-ready invoices with their status as the reason", async () => {
    const res = await call({
      validations: [validation({ submissionId: "s1", statusCode: "REVIEW_REQUIRED" })],
      submissions: [submission("s1")],
    });
    const body = res.body as { skipped: Array<{ reason: string }> };
    expect(body.skipped[0].reason).toBe("Status is REVIEW_REQUIRED");
    expect(uploadPdf).not.toHaveBeenCalled();
  });
});
