/**
 * e2e/smoke.spec.ts
 *
 * Navigation smoke test: every sidebar link from AppShell must be present
 * with the right href on an authenticated page, and the shell must mount.
 *
 * Auth is handled by e2e/fixtures.ts, which logs in once through the
 * real /login form and shares that session across every test.
 */

import { test, expect } from "./fixtures";

// hrefs of the links currently rendered in the sidebar. Entries listed in
// the *_HIDDEN_KEYS arrays of src/components/layout/AppShell.tsx (leads,
// pipeline-sync, outbound-invoices, accounting, ...) are hidden from nav but
// stay reachable by URL, which e2e/pages.spec.ts covers. Admin-only entries
// are included because the e2e account is an admin.
const NAV_HREFS = [
  "/dashboard", "/proposals", "/budget", "/contracts", "/invoices", "/expenses",
  "/cash-collection", "/cash-payment", "/logs", "/archives", "/users", "/admin",
  "/reports", "/config", "/feedback",
];

test.describe("Navigation smoke", () => {
  test("sidebar mounts with the Dashboard link", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("nav a", { hasText: "Dashboard" }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("every sidebar nav link is present with the right href", async ({ page }) => {
    await page.goto("/dashboard");
    for (const href of NAV_HREFS) {
      await expect(page.locator(`nav a[href="${href}"]`).first()).toHaveAttribute("href", href);
    }
  });

  test("nav hrefs are unique", () => {
    expect(new Set(NAV_HREFS).size).toBe(NAV_HREFS.length);
  });
});
