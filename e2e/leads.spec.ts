/**
 * e2e/leads.spec.ts
 *
 * Lead pipeline flow for the /leads page:
 *   1. Navigate to /leads
 *   2. Open "+ Add Lead" modal
 *   3. Fill in title, clientName, estimatedValue → save
 *   4. Verify the new lead appears with a "New" stage badge
 *   5. Click Edit → change stage to "Contacted" → save
 *   6. Verify the stage badge updates to "Contacted"
 *
 * API calls are intercepted via Playwright route mocks so no real backend is
 * required.  The in-memory store resets between tests via beforeEach.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Fixture data ─────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  source: string;
  stage: string;
  estimatedValue: number;
  currency: string;
  probability: number;
  expectedCloseDate: string;
  assignedTo: string;
  notes: string;
  lostReason: string;
  createdAt: string;
  updatedAt: string;
  proposalId?: string;
}

const NEW_LEAD: Lead = {
  id: "lead_e2e_001",
  title: "E2E Test Opportunity",
  clientId: "",
  clientName: "Test Client Co",
  contactName: "",
  contactEmail: "",
  source: "inbound",
  stage: "new",
  estimatedValue: 500_000,
  currency: "JPY",
  probability: 0,
  expectedCloseDate: "",
  assignedTo: "",
  notes: "",
  lostReason: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function setupLeadApiMocks(page: Page, store: { leads: Lead[] }) {
  // GET + POST /api/leads
  page.route("**/api/leads", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      // Build summary byStage counts
      const byStage: Record<string, number> = {};
      for (const l of store.leads) {
        byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leads: store.leads, summary: { byStage } }),
      });
    } else if (method === "POST") {
      const body = await route.request().postDataJSON() as Lead;
      store.leads.push({ ...body, updatedAt: new Date().toISOString() });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ lead: body }),
      });
    } else {
      await route.continue();
    }
  });

  // PUT + DELETE /api/leads/:id
  page.route("**/api/leads/**", async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const id = url.split("/").pop()!;

    if (method === "PUT") {
      const body = await route.request().postDataJSON() as Partial<Lead>;
      store.leads = store.leads.map((l) =>
        l.id === id ? { ...l, ...body, updatedAt: new Date().toISOString() } : l
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lead: store.leads.find((l) => l.id === id) }),
      });
    } else if (method === "DELETE") {
      store.leads = store.leads.filter((l) => l.id !== id);
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.continue();
    }
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("/leads — pipeline flow", () => {
  let store: { leads: Lead[] };

  test.beforeEach(async ({ page }) => {
    store = { leads: [] };
    await mockAuth(page);
    setupLeadApiMocks(page, store);
  });

  test("empty state shows 'No leads found'", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByText("No leads found.")).toBeVisible({ timeout: 10_000 });
  });

  test("add a new lead and verify 'New' stage badge", async ({ page }) => {
    await page.goto("/leads");

    // Open modal
    await page.getByRole("button", { name: "+ Add Lead" }).click();
    await expect(page.getByRole("heading", { name: "Add Lead" })).toBeVisible();

    // Fill required fields
    await page.getByPlaceholder("Deal or opportunity title").fill(NEW_LEAD.title);
    await page.getByPlaceholder("Acme Corp").fill(NEW_LEAD.clientName);
    await page.getByPlaceholder("500000").fill(String(NEW_LEAD.estimatedValue));

    // Save
    await page.getByRole("button", { name: "Save Lead" }).click();
    await expect(page.getByRole("heading", { name: "Add Lead" })).not.toBeVisible();

    // Lead row should appear with title and "New" stage badge
    await expect(page.getByRole("cell", { name: NEW_LEAD.title })).toBeVisible({ timeout: 10_000 });

    // The stage badge for "new" renders as "New" (from STAGE_LABELS)
    const row = page.getByRole("row", { name: new RegExp(NEW_LEAD.title) });
    await expect(row.getByText("New")).toBeVisible();
  });

  test("edit lead stage from 'New' to 'Contacted' and verify badge updates", async ({ page }) => {
    store.leads = [{ ...NEW_LEAD }];

    await page.goto("/leads");
    await expect(page.getByRole("cell", { name: NEW_LEAD.title })).toBeVisible({ timeout: 10_000 });

    // Open edit modal
    const row = page.getByRole("row", { name: new RegExp(NEW_LEAD.title) });
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Lead" })).toBeVisible();

    // Change Stage select to "Contacted"
    const stageSelect = page.locator("label", { hasText: "Stage" })
      .locator("..").locator("select");
    await stageSelect.selectOption("contacted");

    // Save
    await page.getByRole("button", { name: "Save Lead" }).click();
    await expect(page.getByRole("heading", { name: "Edit Lead" })).not.toBeVisible();

    // Stage badge should now read "Contacted"
    const updatedRow = page.getByRole("row", { name: new RegExp(NEW_LEAD.title) });
    await expect(updatedRow.getByText("Contacted")).toBeVisible({ timeout: 10_000 });
    await expect(updatedRow.getByText("New")).not.toBeVisible();
  });

  test("full pipeline flow: add → verify New → edit to Contacted → verify badge", async ({ page }) => {
    // ── 1. Navigate ──────────────────────────────────────────────────────────
    await page.goto("/leads");
    await expect(page.getByText("No leads found.")).toBeVisible({ timeout: 10_000 });

    // ── 2. Create ────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "+ Add Lead" }).click();
    await expect(page.getByRole("heading", { name: "Add Lead" })).toBeVisible();

    await page.getByPlaceholder("Deal or opportunity title").fill(NEW_LEAD.title);
    await page.getByPlaceholder("Acme Corp").fill(NEW_LEAD.clientName);
    await page.getByPlaceholder("500000").fill(String(NEW_LEAD.estimatedValue));

    await page.getByRole("button", { name: "Save Lead" }).click();
    await expect(page.getByRole("cell", { name: NEW_LEAD.title })).toBeVisible({ timeout: 10_000 });

    // Verify "New" badge
    const row = page.getByRole("row", { name: new RegExp(NEW_LEAD.title) });
    await expect(row.getByText("New")).toBeVisible();

    // ── 3. Edit stage ─────────────────────────────────────────────────────────
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Lead" })).toBeVisible();

    const stageSelect = page.locator("label", { hasText: "Stage" })
      .locator("..").locator("select");
    await stageSelect.selectOption("contacted");

    await page.getByRole("button", { name: "Save Lead" }).click();
    await expect(page.getByRole("heading", { name: "Edit Lead" })).not.toBeVisible();

    // ── 4. Verify badge updated ──────────────────────────────────────────────
    const updatedRow = page.getByRole("row", { name: new RegExp(NEW_LEAD.title) });
    await expect(updatedRow.getByText("Contacted")).toBeVisible({ timeout: 10_000 });
  });

  test("stage filter pills are rendered for all stages", async ({ page }) => {
    await page.goto("/leads");

    // All 8 stage filters + "All" pill should be visible
    for (const label of ["All", "New", "Contacted", "Qualified", "Proposal Sent", "Negotiation", "Won", "Lost", "On Hold"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible({ timeout: 10_000 });
    }
  });
});
