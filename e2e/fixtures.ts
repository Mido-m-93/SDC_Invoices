/**
 * e2e/fixtures.ts
 *
 * middleware.ts checks auth server-side via supabase.auth.getUser(), so page.route()
 * mocking can't fake it — we sign in for real through /login.
 *
 * One browser context per worker, logged in once and shared by every test:
 * Supabase rotates refresh tokens, so giving each test its own copy of a saved
 * session lets a stale token revoke the whole session mid-run. A shared cookie
 * jar keeps the rotated tokens. The app_lang cookie pins the UI to English
 * (the app defaults to Japanese).
 */
import { test as base, expect, chromium, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function signIn(context: BrowserContext): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set (see .env.local.example).");
  }
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 45_000 });
  await page.close();
}

export const test = base.extend<{ page: Page }, { sharedContext: BrowserContext }>({
  sharedContext: [
    async ({}, use) => {
      const browser = await chromium.launch();
      const context = await browser.newContext({ baseURL: BASE_URL });
      await context.addCookies([{ name: "app_lang", value: "en", url: BASE_URL }]);
      await signIn(context);
      await use(context);
      await browser.close();
    },
    { scope: "worker" },
  ],
  page: async ({ sharedContext }, use) => {
    // Supabase can drop the session mid-run (refresh-token rotation races);
    // re-login when a probe request lands on /login instead of failing the test.
    const res = await sharedContext.request.get("/dashboard", { maxRedirects: 0 });
    if (res.status() >= 300 && res.status() < 400) await signIn(sharedContext);
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
export type { Page };
