// Route-level tests for the account-approval flow: approve and signup-notify.
// Next runtime modules, the auth guard, Supabase and the user listing are mocked;
// accountEmails / navTabs / authz run for real, with fetch stubbed.

jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: unknown) => ({ body, init }) },
}));
jest.mock("@/lib/auth-guard", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ getSupabaseClient: jest.fn() }));
jest.mock("@/lib/authUsers", () => ({ listAllAuthUsers: jest.fn() }));

import { POST as approve } from "@/app/api/users/[id]/approve/route";
import { POST as signupNotify } from "@/app/api/auth/signup-notify/route";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";
import { listAllAuthUsers } from "@/lib/authUsers";

type Res = { body: Record<string, unknown>; init?: { status?: number } };

const updateUserById = jest.fn();
const getUserById = jest.fn();
const fetchMock = jest.fn();
const req = (body: unknown = {}) =>
  ({ json: async () => body, nextUrl: { origin: "http://app" } }) as never;
const asAdmin = () =>
  (requireAdmin as jest.Mock).mockResolvedValue({ user: { id: "admin" }, response: null });
const emailOk = (ok: boolean) => fetchMock.mockResolvedValue({ ok, text: async () => "" });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  global.fetch = fetchMock as never;
  (getSupabaseClient as jest.Mock).mockReturnValue({ auth: { admin: { updateUserById, getUserById } } });
  updateUserById.mockResolvedValue({ data: { user: { email: "new@x.com" } }, error: null });
  getUserById.mockResolvedValue({ data: { user: { app_metadata: {} } }, error: null });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/users/[id]/approve", () => {
  const call = (body: unknown) => approve(req(body), { params: { id: "u1" } }) as unknown as Promise<Res>;

  it("returns the guard's response for non-admins and touches nothing", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue({ user: null, response: { init: { status: 403 } } });
    const res = await call({ tabs: null });
    expect(res.init?.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("rejects unknown tabs with 400", async () => {
    asAdmin();
    expect((await call({ tabs: ["/users"] })).init?.status).toBe(400);
    expect((await call({})).init?.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("refuses users who aren't pending (409)", async () => {
    asAdmin();
    getUserById.mockResolvedValue({ data: { user: { app_metadata: { approval: "approved" } } }, error: null });
    expect((await call({ tabs: null })).init?.status).toBe(409);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("approves with the chosen tabs and emails the user", async () => {
    asAdmin();
    emailOk(true);
    const res = await call({ tabs: ["/invoices"] });
    expect(updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { approval: "approved", allowedTabs: ["/invoices"] },
    });
    expect(res.body).toEqual({ ok: true, emailed: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(["new@x.com"]);
  });

  it("still approves when the email fails", async () => {
    asAdmin();
    emailOk(false);
    const res = await call({ tabs: null });
    expect(res.body).toEqual({ ok: true, emailed: false });
  });
});

describe("POST /api/auth/signup-notify", () => {
  const user = (over: Record<string, unknown>) => ({
    id: "x", email: "x@x.com", isAdmin: false, isPending: false, archivedAt: null, signupNotifiedAt: null, ...over,
  });
  const call = () => signupNotify(req()) as unknown as Promise<Res>;
  const notifiedValues = () => updateUserById.mock.calls.map(([, p]) => p.app_metadata.signupNotifiedAt);

  it("emails active admins about new pending users and keeps them marked", async () => {
    (listAllAuthUsers as jest.Mock).mockResolvedValue([
      user({ id: "a", email: "boss@x.com", isAdmin: true }),
      user({ id: "old", email: "gone@x.com", isAdmin: true, archivedAt: "2026-01-01" }),
      user({ id: "p", email: "new@x.com", isPending: true }),
    ]);
    emailOk(true);
    expect((await call()).body).toEqual({ ok: true });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.to).toEqual(["boss@x.com"]);
    expect(sent.html).toContain("new@x.com");
    expect(notifiedValues()).toEqual([expect.any(String)]);
  });

  it("releases the claim when the email fails, so it retries", async () => {
    (listAllAuthUsers as jest.Mock).mockResolvedValue([
      user({ id: "a", email: "boss@x.com", isAdmin: true }),
      user({ id: "p", isPending: true }),
    ]);
    emailOk(false);
    await call();
    expect(notifiedValues()).toEqual([expect.any(String), null]);
  });

  it("does nothing when no one is waiting", async () => {
    (listAllAuthUsers as jest.Mock).mockResolvedValue([
      user({ id: "a", isAdmin: true }),
      user({ id: "told", isPending: true, signupNotifiedAt: "2026-01-01" }),
      user({ id: "rejected", isPending: true, archivedAt: "2026-01-01" }),
    ]);
    await call();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
