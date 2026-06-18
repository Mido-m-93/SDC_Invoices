/**
 * e2e/clients.spec.ts
 *
 * Full CRUD flow for the /clients page:
 *   1. Navigate to /clients
 *   2. Open "+ Add Client" modal
 *   3. Fill in name, industry, contact fields and save
 *   4. Verify the new row appears in the table
 *   5. Click Edit → change the company name → save
 *   6. Verify the updated name appears in the table
 *   7. Click Delete → confirm the browser dialog → verify the row disappears
 *
 * The tests stub the /api/clients REST endpoints so no real database is needed.
 * Each test in the suite builds on an in-memory store that resets per test via
 * beforeEach so the tests remain independent.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Shared fixture data ──────────────────────────────────────────────────────

const NEW_CLIENT = {
  id: "cli_e2e_001",
  name: "Acme Test Corp",
  legalName: "Acme Test Corp K.K.",
  industry: "Technology",
  contactName: "Taro Yamada",
  contactEmail: "taro@acme-test.com",
  contactPhone: "+81-3-0000-0001",
  address: "1-1-1 Marunouchi, Chiyoda-ku, Tokyo",
  country: "JP",
  taxRegistrationNumber: "T1234567890001",
  status: "prospect" as const,
  notes: "E2E test client",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const UPDATED_NAME = "Acme Test Corp UPDATED";

// ── Auth + API mock helpers ──────────────────────────────────────────────────

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

/** Wire up GET/POST/PUT/DELETE stubs for /api/clients using a shared array. */
function setupClientApiMocks(page: Page, store: { clients: typeof NEW_CLIENT[] }) {
  // GET /api/clients
  page.route("**/api/clients", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ clients: store.clients }),
      });
    } else if (route.request().method() === "POST") {
      // Create
      const body = await route.request().postDataJSON() as typeof NEW_CLIENT;
      store.clients.push({ ...body, updatedAt: new Date().toISOString() });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ client: body }),
      });
    } else {
      await route.continue();
    }
  });

  // PUT /api/clients/:id  and  DELETE /api/clients/:id
  page.route("**/api/clients/**", async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const id = url.split("/").pop()!;

    if (method === "PUT") {
      const body = await route.request().postDataJSON() as Partial<typeof NEW_CLIENT>;
      store.clients = store.clients.map((c) =>
        c.id === id ? { ...c, ...body, updatedAt: new Date().toISOString() } : c
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ client: store.clients.find((c) => c.id === id) }),
      });
    } else if (method === "DELETE") {
      store.clients = store.clients.filter((c) => c.id !== id);
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.continue();
    }
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("/clients — CRUD flow", () => {
  let store: { clients: typeof NEW_CLIENT[] };

  test.beforeEach(async ({ page }) => {
    store = { clients: [] };
    await mockAuth(page);
    setupClientApiMocks(page, store);
  });

  test("empty state shows 'No clients registered yet'", async ({ page }) => {
    await page.goto("/clients");
    await expect(page.getByText("No clients registered yet.")).toBeVisible({ timeout: 10_000 });
  });

  test("add a new client and verify it appears in the table", async ({ page }) => {
    await page.goto("/clients");

    // Open modal
    await page.getByRole("button", { name: "+ Add Client" }).click();
    await expect(page.getByRole("heading", { name: "Add Client" })).toBeVisible();

    // Fill form
    await page.getByPlaceholder("Acme Corporation").fill(NEW_CLIENT.name);
    await page.getByPlaceholder("Technology, Finance, Healthcare…").fill(NEW_CLIENT.industry);
    await page.getByPlaceholder("Taro Yamada").fill(NEW_CLIENT.contactName);
    await page.getByPlaceholder("taro@example.com").fill(NEW_CLIENT.contactEmail);

    // Save
    await page.getByRole("button", { name: "Save Client" }).click();

    // Modal should close and row should appear
    await expect(page.getByRole("heading", { name: "Add Client" })).not.toBeVisible();
    await expect(page.getByRole("cell", { name: NEW_CLIENT.name })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: NEW_CLIENT.industry })).toBeVisible();
  });

  test("edit an existing client and verify updated name in table", async ({ page }) => {
    // Pre-populate store so the table renders immediately
    store.clients = [{ ...NEW_CLIENT }];

    await page.goto("/clients");
    await expect(page.getByRole("cell", { name: NEW_CLIENT.name })).toBeVisible({ timeout: 10_000 });

    // Click Edit on that row
    const row = page.getByRole("row", { name: new RegExp(NEW_CLIENT.name) });
    await row.getByRole("button", { name: "Edit" }).click();

    // Modal opens in edit mode
    await expect(page.getByRole("heading", { name: "Edit Client" })).toBeVisible();

    // Clear and type the new name
    const nameInput = page.getByPlaceholder("Acme Corporation");
    await nameInput.clear();
    await nameInput.fill(UPDATED_NAME);

    // Save
    await page.getByRole("button", { name: "Save Client" }).click();
    await expect(page.getByRole("heading", { name: "Edit Client" })).not.toBeVisible();

    // Updated name should now appear in the table
    await expect(page.getByRole("cell", { name: UPDATED_NAME })).toBeVisible({ timeout: 10_000 });
  });

  test("delete a client and verify row disappears", async ({ page }) => {
    store.clients = [{ ...NEW_CLIENT }];

    await page.goto("/clients");
    await expect(page.getByRole("cell", { name: NEW_CLIENT.name })).toBeVisible({ timeout: 10_000 });

    // Accept the browser confirm dialog
    page.on("dialog", (dialog) => dialog.accept());

    const row = page.getByRole("row", { name: new RegExp(NEW_CLIENT.name) });
    await row.getByRole("button", { name: "Delete" }).click();

    // Row must vanish; empty state message should reappear
    await expect(page.getByRole("cell", { name: NEW_CLIENT.name })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("No clients registered yet.")).toBeVisible();
  });

  test("full CRUD sequence in a single flow", async ({ page }) => {
    // ── 1. Navigate ──────────────────────────────────────────────────────────
    await page.goto("/clients");
    await expect(page.getByText("No clients registered yet.")).toBeVisible({ timeout: 10_000 });

    // ── 2. Create ────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "+ Add Client" }).click();
    await expect(page.getByRole("heading", { name: "Add Client" })).toBeVisible();

    await page.getByPlaceholder("Acme Corporation").fill(NEW_CLIENT.name);
    await page.getByPlaceholder("Technology, Finance, Healthcare…").fill(NEW_CLIENT.industry);
    await page.getByPlaceholder("Taro Yamada").fill(NEW_CLIENT.contactName);
    await page.getByPlaceholder("taro@example.com").fill(NEW_CLIENT.contactEmail);

    await page.getByRole("button", { name: "Save Client" }).click();
    await expect(page.getByRole("cell", { name: NEW_CLIENT.name })).toBeVisible({ timeout: 10_000 });

    // ── 3. Edit ──────────────────────────────────────────────────────────────
    const row = page.getByRole("row", { name: new RegExp(NEW_CLIENT.name) });
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Client" })).toBeVisible();

    const nameInput = page.getByPlaceholder("Acme Corporation");
    await nameInput.clear();
    await nameInput.fill(UPDATED_NAME);
    await page.getByRole("button", { name: "Save Client" }).click();
    await expect(page.getByRole("cell", { name: UPDATED_NAME })).toBeVisible({ timeout: 10_000 });

    // ── 4. Delete ────────────────────────────────────────────────────────────
    page.on("dialog", (dialog) => dialog.accept());
    const updatedRow = page.getByRole("row", { name: new RegExp(UPDATED_NAME) });
    await updatedRow.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("cell", { name: UPDATED_NAME })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("No clients registered yet.")).toBeVisible();
  });
});
