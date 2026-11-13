// Slack reminders: the message content (it must match the Teams card), the
// sender, the channel selection (Teams / Slack / both) and the saveConfig
// safeguard for the not-yet-applied slack_webhook_url migration.

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase", () => ({ getSupabaseClient: jest.fn() }));

import { SlackNotificationService, buildSlackText, escapeSlack } from "@/lib/services/real/SlackNotificationService";
import { buildNotificationChannels } from "@/lib/services/real/notificationChannels";
import { SupabaseStorageService } from "@/lib/services/real/SupabaseStorageService";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { getSupabaseClient } from "@/lib/supabase";
import type { ReminderType } from "@/types";

const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock as never;
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.useRealTimers();
});

const alert = (id: string, kind: "contract" | "member") => ({ id, kind, name: id, endDate: "2026-01-01" });

describe("buildSlackText: daily summary", () => {
  const summary = (over = {}) => buildSlackText("missing_invoice" as ReminderType, {
    _summary: true, month: "2026-11", gaps: [], stale: [], approaching: [], overdue: [], ...over,
  });

  it("lists the same seven items as the Teams card and the dashboard", () => {
    const text = summary();
    for (const label of [
      "Missing Submissions", "Stale Reviews", "Due Soon", "Overdue",
      "Pending Expenses", "Expired Client Contracts", "Expired Member Contracts",
    ]) expect(text).toContain(label);
    expect(text).toContain("Daily Summary — 2026-11");
  });

  it("shows counts, splitting client and member contracts", () => {
    const text = summary({
      pendingExpenses: 10,
      overdue: [{ payerName: "A", amount: "¥1", daysUntilDue: -2, dueDate: "2026-10-01" }],
      expiredContracts: [alert("c1", "contract"), alert("c2", "contract"), alert("c3", "contract"),
        ...Array.from({ length: 17 }, (_, i) => alert(`m${i}`, "member"))],
    });
    expect(text).toContain("Pending Expenses: 10件 / 10 claim(s)");
    expect(text).toContain("Overdue: 1件 / 1 invoice(s)");
    expect(text).toContain("Expired Client Contracts: 3件 / 3 contract(s)");
    expect(text).toContain("Expired Member Contracts: 17件 / 17 contract(s)");
    expect(text).toContain("Some items require attention.");
  });

  it("says everything looks good when all counts are zero", () => {
    const text = summary({ pendingExpenses: 0, expiredContracts: [] });
    expect(text).toContain("Everything looks good.");
    expect(text).not.toContain("Some items require attention.");
  });

  it("is not all-clear when only pending expenses exist", () => {
    expect(summary({ pendingExpenses: 2 })).toContain("Some items require attention.");
  });
});

describe("buildSlackText: individual reminders (same payload shapes as the Teams cards)", () => {
  it("missing_invoice lists each vendor", () => {
    const text = buildSlackText("missing_invoice", { month: "2026-11", gaps: [{ vendorName: "Acme", contractName: "Retainer", expectedAmount: 120000 }] });
    expect(text).toContain("Missing Invoices — 2026-11");
    expect(text).toContain("• Acme: ¥120,000 — Retainer");
  });

  it("stale_review, due_date_approaching, due_date_overdue and contract_expired list their items", () => {
    expect(buildSlackText("stale_review", { stale: [{ payerName: "B", statusCode: "REVIEW_REQUIRED", staleDays: 5 }] })).toContain("• B: REVIEW_REQUIRED — 5日滞留 / 5d stale");
    expect(buildSlackText("due_date_approaching", { due: [{ payerName: "C", amount: "¥9", daysUntilDue: 3, dueDate: "2026-11-20" }] })).toContain("• C: ¥9 — 3日後 / due in 3d (2026-11-20)");
    expect(buildSlackText("due_date_overdue", { overdue: [{ payerName: "D", amount: "¥9", daysUntilDue: -4, dueDate: "2026-11-01" }] })).toContain("• D: ¥9 — 4日超過 / 4d overdue");
    expect(buildSlackText("contract_expired", { items: [alert("Osaka", "contract"), alert("Taro", "member")] })).toMatch(/📄 Osaka: ended 2026-01-01[\s\S]*👤 Taro: ended 2026-01-01/);
  });

  it("shows an all-clear line for empty lists", () => {
    expect(buildSlackText("stale_review", { stale: [] })).toContain("✅");
  });

  it("caps long lists and says how many more", () => {
    const gaps = Array.from({ length: 25 }, (_, i) => ({ vendorName: `V${i}`, contractName: "c", expectedAmount: 1 }));
    const text = buildSlackText("missing_invoice", { month: "m", gaps });
    expect(text).toContain("• V19:");
    expect(text).not.toContain("• V20:");
    expect(text).toContain("and 5 more");
  });

  it("keeps the escalation message", () => {
    expect(buildSlackText("escalation", { payerName: "E", blockedDays: 7 })).toContain("BLOCKED for 7 days");
  });

  it("escapes Slack control characters so a form-supplied name cannot @-mention the channel", () => {
    expect(escapeSlack("<!channel> & <b>")).toBe("&lt;!channel&gt; &amp; &lt;b&gt;");
    const text = buildSlackText("stale_review", { stale: [{ payerName: "<!channel>", statusCode: "X", staleDays: 1 }] });
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt;");
  });
});

describe("SlackNotificationService", () => {
  it("posts {text} to the webhook and reports success", async () => {
    const ok = await new SlackNotificationService("https://hooks.slack.test/x").sendReminder({ type: "stale_review", payload: { stale: [] } });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/x");
    expect(JSON.parse(init.body)).toEqual({ text: expect.stringContaining("Stale Reviews") });
  });

  it("returns false (after one retry) when Slack keeps refusing", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const promise = new SlackNotificationService("https://hooks.slack.test/x").sendReminder({ type: "stale_review", payload: {} });
    await jest.advanceTimersByTimeAsync(1100);
    expect(await promise).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns false instead of throwing on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await new SlackNotificationService("https://hooks.slack.test/x").sendReminder({ type: "stale_review", payload: {} })).toBe(false);
  });

  it("testConnection reports ok / the HTTP status", async () => {
    const svc = new SlackNotificationService("https://hooks.slack.test/x");
    expect((await svc.testConnection()).ok).toBe(true);
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const bad = await svc.testConnection();
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("404");
  });
});

describe("buildNotificationChannels", () => {
  const reminder = { type: "stale_review" as ReminderType, payload: { stale: [] } };

  it("returns null when no valid URL is configured (https only)", () => {
    expect(buildNotificationChannels({})).toBeNull();
    expect(buildNotificationChannels({ teamsUrl: "", slackUrl: "http://insecure.example" })).toBeNull();
  });

  it("uses Teams only, or Slack only, when just one is set", () => {
    expect(buildNotificationChannels({ teamsUrl: "https://t.example" })?.names).toEqual(["teams"]);
    expect(buildNotificationChannels({ slackUrl: "https://s.example" })?.names).toEqual(["slack"]);
  });

  it("sends each reminder to both channels when both are set", async () => {
    const channels = buildNotificationChannels({ teamsUrl: "https://t.example/hook", slackUrl: "https://s.example/hook" });
    expect(channels?.names).toEqual(["teams", "slack"]);
    expect(await channels!.service.sendReminder(reminder)).toBe(true);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(["https://s.example/hook", "https://t.example/hook"]);
  });

  it("still succeeds when one channel fails but the other delivers", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) => (url.includes("s.example") ? { ok: false, status: 500 } : { ok: true, status: 200 }));
    const channels = buildNotificationChannels({ teamsUrl: "https://t.example/hook", slackUrl: "https://s.example/hook" });
    const promise = channels!.service.sendReminder(reminder);
    await jest.advanceTimersByTimeAsync(1100);
    expect(await promise).toBe(true);
  });
});

describe("saveConfig and the slack_webhook_url column (migration 053)", () => {
  const upsert = jest.fn();
  beforeEach(() => {
    (getSupabaseClient as jest.Mock).mockReturnValue({ from: () => ({ upsert }) });
  });
  const missingColumn = { error: { message: "Could not find the 'slack_webhook_url' column of 'app_config' in the schema cache" } };

  it("saves the Slack URL with the other settings", async () => {
    upsert.mockResolvedValue({ error: null });
    await new SupabaseStorageService().saveConfig({ ...DEFAULT_CONFIG, slackWebhookUrl: "https://hooks.slack.test/x" });
    expect(upsert.mock.calls[0][0]).toMatchObject({ id: "main", slack_webhook_url: "https://hooks.slack.test/x" });
  });

  it("writes an empty string when the URL is cleared (turns Slack off)", async () => {
    upsert.mockResolvedValue({ error: null });
    await new SupabaseStorageService().saveConfig({ ...DEFAULT_CONFIG, slackWebhookUrl: "" });
    expect(upsert.mock.calls[0][0].slack_webhook_url).toBe("");
  });

  it("before the migration: other settings still save when no Slack URL is set", async () => {
    upsert.mockResolvedValueOnce(missingColumn).mockResolvedValueOnce({ error: null });
    await expect(new SupabaseStorageService().saveConfig({ ...DEFAULT_CONFIG, slackWebhookUrl: "" })).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0]).not.toHaveProperty("slack_webhook_url");
  });

  it("before the migration: setting a Slack URL fails with a clear message about the migration", async () => {
    upsert.mockResolvedValue(missingColumn);
    await expect(new SupabaseStorageService().saveConfig({ ...DEFAULT_CONFIG, slackWebhookUrl: "https://hooks.slack.test/x" }))
      .rejects.toThrow(/053_app_config_slack_webhook\.sql/);
  });

  it("other save errors are still reported", async () => {
    upsert.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(new SupabaseStorageService().saveConfig(DEFAULT_CONFIG)).rejects.toThrow("saveConfig: permission denied");
  });
});
