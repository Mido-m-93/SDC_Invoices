/**
 * e2e/pages.spec.ts
 *
 * Every authenticated page must load without a server error or console
 * crash, and must not scroll horizontally at phone width. Also guards the
 * hidden-feature removal: the old Money Forward buttons must not come back.
 */

import { test, expect } from "./fixtures";

const PAGES = [
  "/dashboard", "/clients", "/leads", "/proposals", "/invoices", "/expenses",
  "/outbound-invoices", "/payment-records", "/accounting", "/close-checklist",
  "/close", "/members", "/reporting", "/reports", "/vendors", "/contracts",
  "/logs", "/config", "/admin", "/archives", "/budget", "/cash-collection",
  "/cash-payment", "/exceptions", "/feedback", "/link-review", "/pipeline-sync",
  "/users",
];

for (const path of PAGES) {
  test.describe(path, () => {
    test("desktop: loads without errors", async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const res = await page.goto(path);
      expect(res?.status() ?? 200).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText(/Application error|Internal Server Error/i)).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });

    test("mobile 440px: no horizontal page scroll", async ({ page }) => {
      await page.setViewportSize({ width: 440, height: 900 });
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("removed hidden features stay removed", () => {
  test("Expenses has no New claim / Send to MF / Create payee", async ({ page }) => {
    await page.goto("/expenses");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("button", { name: /new claim/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /send to money ?forward/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /payee/i })).toHaveCount(0);
  });

  test("Settings has no Money Forward sandbox card", async ({ page }) => {
    await page.goto("/config");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText(/Sandbox Test/i)).toHaveCount(0);
  });

  test("Admin lists only the remaining feature flag", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("SHOW_EXPENSES_UPLOAD_EXCEL")).toBeVisible();
    await expect(page.getByText(/SHOW_SEND_TO_MF|SHOW_CREATE_MF_PAYEE|SHOW_MF_SANDBOX_TEST/)).toHaveCount(0);
  });

  test("Admin Tools text has no em dashes", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("SharePoint Pipeline folder")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("—");
  });
});
