// Route tests for "Undo Paid": invoices (/api/invoices/unmark-paid) and
// expenses (/api/expenses/[id]/undo-paid). Next runtime modules, the auth
// guard and the service layer are mocked.

jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: unknown) => ({ body, init }) },
}));
jest.mock("@/lib/auth-guard", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/services", () => ({ getStorageService: jest.fn(), getExpenseService: jest.fn() }));

import { POST as unmarkInvoicePaid } from "@/app/api/invoices/unmark-paid/route";
import { POST as undoExpensePaid } from "@/app/api/expenses/[id]/undo-paid/route";
import { requireAuth } from "@/lib/auth-guard";
import { getStorageService, getExpenseService } from "@/lib/services";

type Res = { body: Record<string, unknown>; init?: { status?: number } };

const loadFiledDocuments = jest.fn();
const markFiledDocumentUnpaid = jest.fn();
const getClaim = jest.fn();
const saveClaim = jest.fn();

const invoiceReq = (body: unknown) => ({ json: async () => body }) as never;
const signedIn = () => (requireAuth as jest.Mock).mockResolvedValue({ user: { id: "u" }, response: null });

beforeEach(() => {
  jest.clearAllMocks();
  (getStorageService as jest.Mock).mockReturnValue({ loadFiledDocuments, markFiledDocumentUnpaid });
  (getExpenseService as jest.Mock).mockReturnValue({ getClaim, saveClaim });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/invoices/unmark-paid", () => {
  const call = (body: unknown) => unmarkInvoicePaid(invoiceReq(body)) as unknown as Promise<Res>;

  it("returns the guard's response when not signed in and changes nothing", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ user: null, response: { init: { status: 401 } } });
    const res = await call({ submissionId: "s1" });
    expect(res.init?.status).toBe(401);
    expect(markFiledDocumentUnpaid).not.toHaveBeenCalled();
  });

  it("rejects a missing submissionId (400)", async () => {
    signedIn();
    expect((await call({})).init?.status).toBe(400);
  });

  it("404s when nothing was filed for the submission", async () => {
    signedIn();
    loadFiledDocuments.mockResolvedValue([undefined]);
    expect((await call({ submissionId: "s1" })).init?.status).toBe(404);
    expect(markFiledDocumentUnpaid).not.toHaveBeenCalled();
  });

  it("409s when the invoice is not marked paid", async () => {
    signedIn();
    loadFiledDocuments.mockResolvedValue([{ submissionId: "s1", paidAt: null }]);
    expect((await call({ submissionId: "s1" })).init?.status).toBe(409);
    expect(markFiledDocumentUnpaid).not.toHaveBeenCalled();
  });

  it("clears the paid mark on a paid invoice", async () => {
    signedIn();
    loadFiledDocuments.mockResolvedValue([{ submissionId: "s1", paidAt: "2026-09-12T00:00:00Z" }]);
    const res = await call({ submissionId: "s1" });
    expect(res.body).toEqual({ ok: true });
    expect(markFiledDocumentUnpaid).toHaveBeenCalledWith("s1");
  });
});

describe("POST /api/expenses/[id]/undo-paid", () => {
  const call = () => undoExpensePaid({} as never, { params: { id: "c1" } }) as unknown as Promise<Res>;

  it("returns the guard's response when not signed in", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ user: null, response: { init: { status: 401 } } });
    expect((await call()).init?.status).toBe(401);
    expect(saveClaim).not.toHaveBeenCalled();
  });

  it("404s for an unknown claim", async () => {
    signedIn();
    getClaim.mockResolvedValue(null);
    expect((await call()).init?.status).toBe(404);
  });

  it("only accepts paid claims (400 for approved / submitted)", async () => {
    signedIn();
    for (const status of ["approved", "submitted", "rejected"]) {
      getClaim.mockResolvedValue({ id: "c1", status, paidAt: null });
      expect((await call()).init?.status).toBe(400);
    }
    expect(saveClaim).not.toHaveBeenCalled();
  });

  it("puts a paid claim back to approved and clears the paid date, keeping everything else", async () => {
    signedIn();
    getClaim.mockResolvedValue({
      id: "c1", status: "paid", paidAt: "2026-09-12T00:00:00Z", approvedBy: "Reviewer", filedStoragePath: "x/y.pdf", amount: 6040,
    });
    const res = await call();
    expect(res.body).toEqual({ ok: true });
    expect(saveClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", status: "approved", paidAt: null, approvedBy: "Reviewer", filedStoragePath: "x/y.pdf", amount: 6040 })
    );
  });
});
