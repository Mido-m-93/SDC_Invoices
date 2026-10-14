// Route tests for "Undo Save": invoices (/api/invoices/unsave) and expenses
// (/api/expenses/[id]/undo-save). Next runtime modules, the auth guard, the
// service layer and Supabase storage are mocked.

jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: unknown) => ({ body, init }) },
}));
jest.mock("@/lib/auth-guard", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/services", () => ({
  getStorageService: jest.fn(),
  getExpenseService: jest.fn(),
  getDriveService: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({ getSupabaseClient: jest.fn() }));

import { POST as unsaveInvoice } from "@/app/api/invoices/unsave/route";
import { POST as undoExpenseSave } from "@/app/api/expenses/[id]/undo-save/route";
import { requireAuth } from "@/lib/auth-guard";
import { getStorageService, getExpenseService, getDriveService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";

type Res = { body: Record<string, unknown>; init?: { status?: number } };

const order: string[] = [];
const loadFiledDocuments = jest.fn();
const deleteFiledDocument = jest.fn(async () => { order.push("deleteRecord"); });
const trashFile = jest.fn(async () => { order.push("trashDriveFile"); });
const getClaim = jest.fn();
const saveClaim = jest.fn();
const remove = jest.fn();

const signedIn = () => (requireAuth as jest.Mock).mockResolvedValue({ user: { id: "u" }, response: null });

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  (getStorageService as jest.Mock).mockReturnValue({ loadFiledDocuments, deleteFiledDocument });
  (getDriveService as jest.Mock).mockReturnValue({ trashFile });
  (getExpenseService as jest.Mock).mockReturnValue({ getClaim, saveClaim });
  remove.mockResolvedValue({ error: null });
  (getSupabaseClient as jest.Mock).mockReturnValue({ storage: { from: () => ({ remove }) } });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/invoices/unsave", () => {
  const call = (body: unknown) => unsaveInvoice({ json: async () => body } as never) as unknown as Promise<Res>;
  const saved = (over = {}) => loadFiledDocuments.mockResolvedValue([{ submissionId: "s1", driveFileId: "drive-1", paidAt: null, ...over }]);

  it("returns the guard's response when not signed in and changes nothing", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ user: null, response: { init: { status: 401 } } });
    expect((await call({ submissionId: "s1" })).init?.status).toBe(401);
    expect(trashFile).not.toHaveBeenCalled();
    expect(deleteFiledDocument).not.toHaveBeenCalled();
  });

  it("400s without a submissionId", async () => {
    signedIn();
    expect((await call({})).init?.status).toBe(400);
  });

  it("404s when the invoice is not saved", async () => {
    signedIn();
    loadFiledDocuments.mockResolvedValue([undefined]);
    expect((await call({ submissionId: "s1" })).init?.status).toBe(404);
    expect(trashFile).not.toHaveBeenCalled();
  });

  it("409s while the invoice is marked paid, and touches nothing", async () => {
    signedIn();
    saved({ paidAt: "2026-09-12T00:00:00Z" });
    const res = await call({ submissionId: "s1" });
    expect(res.init?.status).toBe(409);
    expect(trashFile).not.toHaveBeenCalled();
    expect(deleteFiledDocument).not.toHaveBeenCalled();
  });

  it("trashes the Drive file first, then removes the record", async () => {
    signedIn();
    saved();
    const res = await call({ submissionId: "s1" });
    expect(res.body).toEqual({ ok: true });
    expect(trashFile).toHaveBeenCalledWith("drive-1");
    expect(deleteFiledDocument).toHaveBeenCalledWith("s1");
    expect(order).toEqual(["trashDriveFile", "deleteRecord"]);
  });

  it("keeps the record (502) when trashing the Drive file fails", async () => {
    signedIn();
    saved();
    trashFile.mockRejectedValueOnce(new Error("Drive down"));
    const res = await call({ submissionId: "s1" });
    expect(res.init?.status).toBe(502);
    expect(deleteFiledDocument).not.toHaveBeenCalled();
  });

  it("just removes the record when there is no Drive file id", async () => {
    signedIn();
    saved({ driveFileId: "" });
    expect((await call({ submissionId: "s1" })).body).toEqual({ ok: true });
    expect(trashFile).not.toHaveBeenCalled();
    expect(deleteFiledDocument).toHaveBeenCalledWith("s1");
  });
});

describe("POST /api/expenses/[id]/undo-save", () => {
  const call = () => undoExpenseSave({} as never, { params: { id: "c1" } }) as unknown as Promise<Res>;
  const claim = (over = {}) =>
    getClaim.mockResolvedValue({ id: "c1", status: "approved", filedStoragePath: "c1/r.pdf", filedAt: "2026-09-10", amount: 6040, approvedBy: "R", ...over });

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

  it("409s while the claim is paid", async () => {
    signedIn();
    claim({ status: "paid" });
    expect((await call()).init?.status).toBe(409);
    expect(saveClaim).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("409s when the claim is not saved", async () => {
    signedIn();
    claim({ filedStoragePath: null });
    expect((await call()).init?.status).toBe(409);
    expect(saveClaim).not.toHaveBeenCalled();
  });

  it("removes the stored receipt and clears the filed fields, keeping the rest", async () => {
    signedIn();
    claim();
    expect((await call()).body).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(["c1/r.pdf"]);
    expect(saveClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", status: "approved", filedStoragePath: null, filedAt: null, amount: 6040, approvedBy: "R" })
    );
  });

  it("still clears the claim when the stored receipt cannot be removed", async () => {
    signedIn();
    claim();
    remove.mockResolvedValue({ error: { message: "nope" } });
    expect((await call()).body).toEqual({ ok: true });
    expect(saveClaim).toHaveBeenCalledWith(expect.objectContaining({ filedStoragePath: null, filedAt: null }));
  });
});
