/**
 * e2e/accounting.spec.ts
 *
 * Accounting entry lifecycle for the /accounting page:
 *   1. Navigate to /accounting (Journal Entries tab is default)
 *   2. Click "+ Add Entry" → fill in description, amount, type=revenue, category
 *   3. Save → verify entry appears in the journal table with a "Draft" status badge
 *   4. Click "Post" on that entry → verify status badge changes to "Posted"
 *   5. Click the "P&L" tab → verify the entry's category appears in the P&L view
 *
 * All HTTP calls are intercepted so no real Supabase or backend is needed.
 * The in-memory store resets between tests via beforeEach.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Types ────────────────────────────────────────────────────────────────────

interface AccountingEntry {
  id: string;
  entryDate: string;
  month: string;
  type: "revenue" | "expense" | "adjustment" | "transfer";
  category: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountJpy: number;
  status: "draft" | "posted" | "voided";
  sourceType: string;
  sourceId: string;
  clientId: string;
  vendorId: string;
  memberId: string;
  notes: string;
  postedBy: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Fixture data ─────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
const CURRENT_MONTH = TODAY.slice(0, 7);

const NEW_ENTRY: AccountingEntry = {
  id: "acct_e2e_001",
  entryDate: TODAY,
  month: CURRENT_MONTH,
  type: "revenue",
  category: "Consulting",
  description: "E2E test revenue entry",
  amount: 100_000,
  currency: "JPY",
  exchangeRate: 1,
  amountJpy: 100_000,
  status: "draft",
  sourceType: "",
  sourceId: "",
  clientId: "",
  vendorId: "",
  memberId: "",
  notes: "",
  postedBy: "",
  postedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── Auth helper ──────────────────────────────────────────────────────────────

async function mockAuth(page: Page) {
  await page.route("**/auth/v1/user**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "test-user-id",
        email: "e2e@example.com",
        role: "authenticated",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: { name: "E2E User" },
      }),
    });
  });
}

// ── API mock helpers ─────────────────────────────────────────────────────────

function buildSummary(entries: AccountingEntry[]) {
  const revenue = entries
    .filter((e) => e.type === "revenue" && e.status === "posted")
    .reduce((s, e) => s + e.amountJpy, 0);
  const expenses = entries
    .filter((e) => e.type === "expense" && e.status === "posted")
    .reduce((s, e) => s + e.amountJpy, 0);
  return { revenue, expenses, profit: revenue - expenses, currency: "JPY" };
}

function buildPl(entries: AccountingEntry[]) {
  const posted = entries.filter((e) => e.status === "posted");
  const totalRevenue = posted
    .filter((e) => e.type === "revenue")
    .reduce((s, e) => s + e.amountJpy, 0);
  const totalExpenses = posted
    .filter((e) => e.type === "expense")
    .reduce((s, e) => s + e.amountJpy, 0);
  const grossProfit = totalRevenue - totalExpenses;
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Category breakdown
  const catMap = new Map<string, { type: string; total: number }>();
  for (const e of posted) {
    const key = `${e.category}__${e.type}`;
    const existing = catMap.get(key);
    if (existing) {
      existing.total += e.amountJpy;
    } else {
      catMap.set(key, { type: e.type, total: e.amountJpy });
    }
  }
  const byCategory = Array.from(catMap.entries()).map(([key, val]) => ({
    category: key.split("__")[0],
    type: val.type,
    total: val.total,
  }));

  return { totalRevenue, totalExpenses, grossProfit, grossMarginPct, byCategory, currency: "JPY", month: CURRENT_MONTH };
}

function setupAccountingApiMocks(page: Page, store: { entries: AccountingEntry[] }) {
  // GET/POST /api/accounting (journal)
  page.route("**/api/accounting?**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: store.entries,
          summary: buildSummary(store.entries),
        }),
      });
    } else {
      await route.continue();
    }
  });

  page.route("**/api/accounting", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: store.entries,
          summary: buildSummary(store.entries),
        }),
      });
    } else if (method === "POST") {
      const body = await route.request().postDataJSON() as AccountingEntry;
      store.entries.push({ ...body, updatedAt: new Date().toISOString() });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ entry: body }),
      });
    } else {
      await route.continue();
    }
  });

  // P&L endpoint
  page.route("**/api/accounting/pl**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPl(store.entries)),
    });
  });

  // /post and /void actions  +  PUT/DELETE /api/accounting/:id
  page.route("**/api/accounting/**", async (route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (method === "POST" && url.endsWith("/post")) {
      const id = url.replace(/\/post$/, "").split("/").pop()!;
      store.entries = store.entries.map((e) =>
        e.id === id
          ? { ...e, status: "posted", postedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : e
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entry: store.entries.find((e) => e.id === id) }),
      });
    } else if (method === "POST" && url.endsWith("/void")) {
      const id = url.replace(/\/void$/, "").split("/").pop()!;
      store.entries = store.entries.map((e) =>
        e.id === id ? { ...e, status: "voided", updatedAt: new Date().toISOString() } : e
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entry: store.entries.find((e) => e.id === id) }),
      });
    } else if (method === "PUT") {
      const id = url.split("/").pop()!;
      const body = await route.request().postDataJSON() as Partial<AccountingEntry>;
      store.entries = store.entries.map((e) =>
        e.id === id ? { ...e, ...body, updatedAt: new Date().toISOString() } : e
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entry: store.entries.find((e) => e.id === id) }),
      });
    } else if (method === "DELETE") {
      const id = url.split("/").pop()!;
      store.entries = store.entries.filter((e) => e.id !== id);
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.continue();
    }
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("/accounting — entry lifecycle", () => {
  let store: { entries: AccountingEntry[] };

  test.beforeEach(async ({ page }) => {
    store = { entries: [] };
    await mockAuth(page);
    setupAccountingApiMocks(page, store);
  });

  test("empty state shows 'No entries found' message", async ({ page }) => {
    await page.goto("/accounting");
    await expect(page.getByText("No entries found for the selected filters.")).toBeVisible({ timeout: 10_000 });
  });

  test("add a new entry and verify Draft badge", async ({ page }) => {
    await page.goto("/accounting");

    // The "+ Add Entry" button is only shown on the Journal tab
    await page.getByRole("button", { name: "+ Add Entry" }).first().click();
    await expect(page.getByRole("heading", { name: "New Journal Entry" })).toBeVisible();

    // Fill in description
    await page.getByPlaceholder("Brief description of this entry…").fill(NEW_ENTRY.description);

    // Set amount
    await page.locator("label", { hasText: "Amount *" })
      .locator("..").locator("input[type='number']")
      .fill(String(NEW_ENTRY.amount));

    // Type should already default to "Revenue" — verify and leave it
    const typeSelect = page.locator("label", { hasText: "Type *" })
      .locator("..").locator("select");
    await expect(typeSelect).toHaveValue("revenue");

    // Fill category
    await page.getByPlaceholder("e.g. Consulting, SaaS, Payroll…").fill(NEW_ENTRY.category);

    // Save
    await page.getByRole("button", { name: "Save Entry" }).click();
    await expect(page.getByRole("heading", { name: "New Journal Entry" })).not.toBeVisible();

    // Row should appear with description and "Draft" status badge
    await expect(page.getByRole("cell", { name: new RegExp(NEW_ENTRY.description) })).toBeVisible({ timeout: 10_000 });

    // The status badge for "draft" renders as "Draft" (capitalize helper in the page)
    const row = page.getByRole("row", { name: new RegExp(NEW_ENTRY.description) });
    await expect(row.getByText("Draft")).toBeVisible();
  });

  test("post a draft entry and verify Posted badge", async ({ page }) => {
    store.entries = [{ ...NEW_ENTRY }];

    await page.goto("/accounting");
    await expect(page.getByRole("cell", { name: new RegExp(NEW_ENTRY.description) })).toBeVisible({ timeout: 10_000 });

    // The "Post" action button is rendered only for draft entries
    const row = page.getByRole("row", { name: new RegExp(NEW_ENTRY.description) });
    await expect(row.getByRole("button", { name: "Post" })).toBeVisible();
    await row.getByRole("button", { name: "Post" }).click();

    // After posting, the row status badge should change to "Posted"
    await expect(row.getByText("Posted")).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Draft")).not.toBeVisible();

    // The "Post" action button should no longer be shown (only void/delete remain)
    await expect(row.getByRole("button", { name: "Post" })).not.toBeVisible();
  });

  test("P&L tab renders category breakdown for posted entries", async ({ page }) => {
    // Pre-populate with a posted revenue entry so P&L has data
    store.entries = [{ ...NEW_ENTRY, status: "posted", postedAt: new Date().toISOString() }];

    await page.goto("/accounting");

    // Switch to P&L tab (tab label is "P&L" as rendered from `tab === "pl" ? "Journal Entries" : "P&L"`)
    await page.getByRole("button", { name: "P&L" }).click();

    // P&L view should render — wait for the Category Breakdown heading
    await expect(page.getByRole("heading", { name: "Category Breakdown" })).toBeVisible({ timeout: 10_000 });

    // The entry's category should appear in the breakdown table
    await expect(page.getByRole("cell", { name: NEW_ENTRY.category })).toBeVisible();
  });

  test("full entry lifecycle: create draft → post → view in P&L", async ({ page }) => {
    // ── 1. Navigate ──────────────────────────────────────────────────────────
    await page.goto("/accounting");
    await expect(page.getByText("No entries found for the selected filters.")).toBeVisible({ timeout: 10_000 });

    // ── 2. Add entry ──────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "+ Add Entry" }).first().click();
    await expect(page.getByRole("heading", { name: "New Journal Entry" })).toBeVisible();

    await page.getByPlaceholder("Brief description of this entry…").fill(NEW_ENTRY.description);
    await page.locator("label", { hasText: "Amount *" })
      .locator("..").locator("input[type='number']")
      .fill(String(NEW_ENTRY.amount));
    await page.getByPlaceholder("e.g. Consulting, SaaS, Payroll…").fill(NEW_ENTRY.category);

    await page.getByRole("button", { name: "Save Entry" }).click();
    await expect(page.getByRole("cell", { name: new RegExp(NEW_ENTRY.description) })).toBeVisible({ timeout: 10_000 });

    // ── 3. Verify Draft badge ─────────────────────────────────────────────────
    const row = page.getByRole("row", { name: new RegExp(NEW_ENTRY.description) });
    await expect(row.getByText("Draft")).toBeVisible();

    // ── 4. Post the entry ─────────────────────────────────────────────────────
    await row.getByRole("button", { name: "Post" }).click();
    await expect(row.getByText("Posted")).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Draft")).not.toBeVisible();

    // ── 5. Switch to P&L tab ──────────────────────────────────────────────────
    await page.getByRole("button", { name: "P&L" }).click();
    await expect(page.getByRole("heading", { name: "Category Breakdown" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: NEW_ENTRY.category })).toBeVisible();
  });
});
