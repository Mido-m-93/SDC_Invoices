import { pendingRedirect } from "@/lib/authz";

describe("pendingRedirect", () => {
  it("sends a pending user from any app page to /pending", () => {
    expect(pendingRedirect("/invoices", true)).toBe("/pending");
  });

  it("keeps a pending user on /pending and lets them reach auth routes", () => {
    expect(pendingRedirect("/pending", true)).toBeNull();
    expect(pendingRedirect("/auth/callback", true)).toBeNull();
  });

  it("sends an approved user away from /pending", () => {
    expect(pendingRedirect("/pending", false)).toBe("/dashboard");
  });

  it("leaves approved users alone elsewhere", () => {
    expect(pendingRedirect("/invoices", false)).toBeNull();
  });
});
