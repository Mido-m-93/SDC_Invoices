// The Teams daily-summary card must show the same seven items as the dashboard's
// Reminder Status panel (Missing, Stale Review, Due Soon, Overdue, Pending
// Expenses, Expired Client Contracts, Expired Member Contracts).

import { TeamsNotificationService } from "@/lib/services/real/TeamsNotificationService";
import type { ReminderType } from "@/types";

type Fact = { title: string; value: string };
type Posted = { attachments: Array<{ content: { body: Array<Record<string, unknown>> } }> };

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  global.fetch = fetchMock as never;
});

async function sendSummary(payload: Record<string, unknown>) {
  const svc = new TeamsNotificationService("https://example.test/webhook");
  const ok = await svc.sendReminder({
    type: "missing_invoice" as ReminderType,
    payload: { _summary: true, month: "2026-11", gaps: [], stale: [], approaching: [], overdue: [], ...payload },
  });
  const posted = JSON.parse(fetchMock.mock.calls[0][1].body) as Posted;
  const body = posted.attachments[0].content.body;
  const facts = (body.find((b) => b.type === "FactSet") as { facts: Fact[] }).facts;
  return { ok, facts, text: JSON.stringify(body) };
}

const byTitle = (facts: Fact[], needle: string) => facts.find((f) => f.title.includes(needle));
const alert = (id: string, kind: "contract" | "member") => ({ id, kind, name: id, endDate: "2026-01-01" });

describe("Teams daily summary card", () => {
  it("lists the same seven items as the dashboard", async () => {
    const { ok, facts } = await sendSummary({});
    expect(ok).toBe(true);
    expect(facts.map((f) => f.title.replace(/^\S+\s/, ""))).toEqual([
      "未提出 / Missing Submissions",
      "承認待ち / Stale Reviews",
      "期日接近 / Due Soon",
      "期日超過 / Overdue",
      "経費承認待ち / Pending Expenses",
      "クライアント契約期限切れ / Expired Client Contracts",
      "メンバー契約期限切れ / Expired Member Contracts",
    ]);
  });

  it("shows the pending expenses count", async () => {
    const { facts } = await sendSummary({ pendingExpenses: 10 });
    expect(byTitle(facts, "Pending Expenses")?.value).toBe("10件 / 10 claim(s)");
  });

  it("splits expired client contracts from expired member contracts", async () => {
    const expiredContracts = [
      alert("c1", "contract"), alert("c2", "contract"), alert("c3", "contract"),
      ...Array.from({ length: 17 }, (_, i) => alert(`m${i}`, "member")),
    ];
    const { facts } = await sendSummary({ expiredContracts });
    expect(byTitle(facts, "Expired Client Contracts")?.value).toBe("3件 / 3 contract(s)");
    expect(byTitle(facts, "Expired Member Contracts")?.value).toBe("17件 / 17 contract(s)");
  });

  it("says 'None' for empty items and reports everything fine when all counts are zero", async () => {
    const { facts, text } = await sendSummary({ pendingExpenses: 0, expiredContracts: [] });
    expect(facts.every((f) => f.value.includes("なし / None"))).toBe(true);
    expect(text).toContain("Everything looks good.");
  });

  it("is not 'all clear' when only pending expenses exist", async () => {
    const { text } = await sendSummary({ pendingExpenses: 2 });
    expect(text).toContain("Some items require attention.");
    expect(text).not.toContain("Everything looks good.");
  });

  it("still works for an older payload without pendingExpenses (treated as none)", async () => {
    const { facts } = await sendSummary({});
    expect(byTitle(facts, "Pending Expenses")?.value).toContain("なし / None");
  });
});
