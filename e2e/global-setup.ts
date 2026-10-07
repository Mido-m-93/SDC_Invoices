/**
 * e2e/global-setup.ts
 *
 * middleware.ts checks auth server-side via supabase.auth.getUser(), a
 * request made by the Next.js server process itself — page.route() network
 * mocking in a test can never intercept it. So instead of faking auth, this
 * logs in for real, once, through the actual /login form, and saves the
 * resulting session so every test's browser context starts already signed in.
 */
import { chromium, type FullConfig } from "@playwright/test";
import path from "node:path";

export const STORAGE_STATE_PATH = path.join(__dirname, ".auth", "user.json");

export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set (see .env.local.example) — " +
      "these tests sign in through the real Supabase auth flow, since middleware " +
      "auth checks run server-side and can't be network-mocked from the browser."
    );
  }

  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });

  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
