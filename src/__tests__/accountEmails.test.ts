import { usersNeedingSignupEmail, signupEmail, approvedEmail } from "@/lib/accountEmails";

const base = { archivedAt: null, signupNotifiedAt: null, isPending: true };

describe("usersNeedingSignupEmail", () => {
  it("picks pending, not-yet-notified, non-archived users only", () => {
    const users = [
      { ...base, id: "new" },
      { ...base, id: "told", signupNotifiedAt: "2026-10-06T00:00:00Z" },
      { ...base, id: "rejected", archivedAt: "2026-10-06T00:00:00Z" },
      { ...base, id: "approved", isPending: false },
    ];
    expect(usersNeedingSignupEmail(users).map((u) => u.id)).toEqual(["new"]);
  });
});

describe("signupEmail", () => {
  it("lists the new accounts and links to the Users page", () => {
    const { subject, html } = signupEmail(["a@x.com", "b@x.com"], "https://app.example");
    expect(subject).toContain("2");
    expect(html).toContain("a@x.com");
    expect(html).toContain("b@x.com");
    expect(html).toContain('href="https://app.example/users"');
  });

  it("escapes HTML in user-supplied email addresses", () => {
    const { html } = signupEmail(['<img src=x onerror="alert(1)">@x.com'], "https://app.example");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("approvedEmail", () => {
  it("links to the login page", () => {
    expect(approvedEmail("https://app.example").html).toContain('href="https://app.example/login"');
  });
});
