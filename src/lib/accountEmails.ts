// src/lib/accountEmails.ts
// Emails for the account-approval flow: "new sign-up waiting" to admins, and
// "you're approved" to the user. Sent via Resend (same env as reminders).

const RESEND_API = "https://api.resend.com/emails";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Pending sign-ups that admins haven't been emailed about yet. */
export function usersNeedingSignupEmail<
  T extends { isPending: boolean; archivedAt: string | null; signupNotifiedAt: string | null },
>(users: T[]): T[] {
  return users.filter((u) => u.isPending && !u.archivedAt && !u.signupNotifiedAt);
}

export function signupEmail(emails: string[], appUrl: string) {
  const items = emails.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return {
    subject: `[SDC] ${emails.length} new sign-up${emails.length === 1 ? "" : "s"} waiting for approval`,
    html:
      `<p>These accounts were created and can't use the app until an admin approves them:</p>` +
      `<ul>${items}</ul>` +
      `<p><a href="${appUrl}/users">Review them on the Users page</a></p>`,
  };
}

export function approvedEmail(appUrl: string) {
  return {
    subject: "[SDC] Your account has been approved",
    html:
      `<p>An administrator approved your account. You can now sign in.</p>` +
      `<p><a href="${appUrl}/login">Sign in</a></p>`,
  };
}

/** Best-effort send. Returns false (never throws) when Resend isn't configured or fails. */
export async function sendEmail(to: string[], email: { subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || to.length === 0) return false;
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFICATION_FROM ?? "noreply@roboco-op.org", to, ...email }),
    });
    if (!res.ok) console.error("[accountEmails] Resend error:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("[accountEmails] send failed:", err);
    return false;
  }
}

/** Base URL for links in emails: APP_URL if set, else the request's own origin. */
export function appUrl(requestOrigin: string): string {
  return (process.env.APP_URL ?? requestOrigin).replace(/\/$/, "");
}
