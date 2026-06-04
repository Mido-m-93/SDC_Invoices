// lib/services/real/TeamsNotificationService.ts
import type { INotificationService } from "../types";
import type { ReminderType, ReminderGap, StaleReview, DueDateAlert } from "@/types";

export class TeamsNotificationService implements INotificationService {
  constructor(private webhookUrl: string) {}

  async sendReminder(data: { type: ReminderType; payload: unknown }): Promise<boolean> {
    try {
      const card = buildAdaptiveCard(data.type, data.payload);
      const ok = await this._post(card);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 1000));
        return this._post(card);
      }
      return true;
    } catch (err) {
      console.error("[TeamsNotification] sendReminder failed:", err);
      return false;
    }
  }

  async sendBatch(
    reminders: Array<{ type: ReminderType; payload: unknown }>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const r of reminders) {
      const ok = await this.sendReminder(r);
      if (ok) sent++; else failed++;
      await new Promise((res) => setTimeout(res, 200));
    }
    return { sent, failed };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const card = buildTestCard();
      const ok = await this._post(card);
      return ok
        ? { ok: true, message: "テスト通知を送信しました / Test notification sent" }
        : { ok: false, message: "Webhook responded with an error" };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  private async _post(body: unknown): Promise<boolean> {
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return res.ok;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function card(body: unknown[]): unknown {
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body,
      },
    }],
  };
}

function header(text: string, color: string) {
  return { type: "TextBlock", text, weight: "Bolder", size: "Medium", color };
}

function subtitle(ja: string, en: string) {
  return { type: "TextBlock", text: `${ja}\n${en}`, wrap: true, isSubtle: true, spacing: "Small" };
}

function separator() {
  return { type: "TextBlock", text: " ", spacing: "None" };
}

// ── Card builders ─────────────────────────────────────────────────────────────

function buildTestCard() {
  return card([
    header("🔔 SDC Invoice Tool — Connection Test", "Accent"),
    subtitle(
      "Teams通知の設定が完了しました。リマインダー通知が正常に届いています。",
      "Teams notifications are configured. Reminders will be delivered to this channel."
    ),
  ]);
}

function buildAdaptiveCard(type: ReminderType, payload: unknown) {
  const p = payload as Record<string, unknown>;
  if (p._summary) {
    return buildSummaryCard(p as {
      month: string;
      gaps: ReminderGap[];
      stale: StaleReview[];
      approaching: DueDateAlert[];
      overdue: DueDateAlert[];
    });
  }
  switch (type) {
    case "missing_invoice":
      return buildMissingInvoiceCard(payload as { gaps: ReminderGap[]; month: string });
    case "stale_review":
      return buildStaleReviewCard(payload as { stale: StaleReview[] });
    case "due_date_approaching":
      return buildDueDateCard(payload as { due: DueDateAlert[] }, false);
    case "due_date_overdue":
      return buildDueDateCard(payload as { overdue: DueDateAlert[] }, true);
  }
}

function buildSummaryCard(payload: {
  month: string;
  gaps: ReminderGap[];
  stale: StaleReview[];
  approaching: DueDateAlert[];
  overdue: DueDateAlert[];
}) {
  const allClear = !payload.gaps.length && !payload.stale.length && !payload.approaching.length && !payload.overdue.length;

  const facts = [
    {
      title: "📋 未提出 / Missing Submissions",
      value: payload.gaps.length ? `${payload.gaps.length}件 / ${payload.gaps.length} vendor(s)` : "✅ なし / None",
    },
    {
      title: "⏳ 承認待ち / Stale Reviews",
      value: payload.stale.length ? `${payload.stale.length}件 / ${payload.stale.length} invoice(s)` : "✅ なし / None",
    },
    {
      title: "⚠️ 期日接近 / Due Soon",
      value: payload.approaching.length ? `${payload.approaching.length}件 / ${payload.approaching.length} invoice(s)` : "✅ なし / None",
    },
    {
      title: "🚨 期日超過 / Overdue",
      value: payload.overdue.length ? `${payload.overdue.length}件 / ${payload.overdue.length} invoice(s)` : "✅ なし / None",
    },
  ];

  return card([
    header(`📊 SDC 日次サマリー / Daily Summary — ${payload.month}`, allClear ? "Good" : "Warning"),
    subtitle(
      allClear ? "すべて問題ありません。" : "確認が必要な項目があります。",
      allClear ? "Everything looks good." : "Some items require attention."
    ),
    separator(),
    { type: "FactSet", facts },
  ]);
}

function buildMissingInvoiceCard(payload: { gaps: ReminderGap[]; month: string }) {
  const hasData = payload.gaps.length > 0;
  return card([
    header(
      `📋 未提出請求書 / Missing Invoices — ${payload.month}`,
      hasData ? "Accent" : "Good"
    ),
    subtitle(
      hasData
        ? `${payload.gaps.length}件のベンダーが今月の請求書を提出していません。`
        : "✅ 全員提出済みです。",
      hasData
        ? `${payload.gaps.length} vendor(s) have not submitted their invoice this month.`
        : "✅ All vendors have submitted."
    ),
    ...(hasData ? [
      separator(),
      {
        type: "FactSet",
        facts: payload.gaps.map((g) => ({
          title: g.vendorName,
          value: `¥${g.expectedAmount.toLocaleString("ja-JP")} — ${g.contractName}`,
        })),
      },
    ] : []),
  ]);
}

function buildStaleReviewCard(payload: { stale: StaleReview[] }) {
  const hasData = payload.stale.length > 0;
  return card([
    header("⏳ 承認待ち・不備 / Stale Reviews", hasData ? "Warning" : "Good"),
    subtitle(
      hasData
        ? `${payload.stale.length}件の請求書が確認待ちです。`
        : "✅ 滞留している請求書はありません。",
      hasData
        ? `${payload.stale.length} invoice(s) are pending review.`
        : "✅ No invoices are awaiting review."
    ),
    ...(hasData ? [
      separator(),
      {
        type: "FactSet",
        facts: payload.stale.map((s) => ({
          title: s.payerName,
          value: `${s.statusCode} — ${s.staleDays}日滞留 / ${s.staleDays}d stale`,
        })),
      },
    ] : []),
  ]);
}

function buildDueDateCard(payload: { due?: DueDateAlert[]; overdue?: DueDateAlert[] }, isOverdue: boolean) {
  const items = payload.due ?? payload.overdue ?? [];
  const hasData = items.length > 0;
  const titleJa = isOverdue ? "🚨 支払期日超過 / Payment Overdue" : "⚠️ 支払期日接近 / Due Date Alert";
  const color = !hasData ? "Good" : isOverdue ? "Attention" : "Warning";

  const descJa = !hasData
    ? (isOverdue ? "✅ 期日超過の請求書はありません。" : "✅ 期日が近い請求書はありません。")
    : isOverdue
      ? `${items.length}件の請求書の支払期日が超過しています。至急確認してください。`
      : `${items.length}件の請求書の支払期日が近づいています。`;

  const descEn = !hasData
    ? (isOverdue ? "✅ No overdue invoices." : "✅ No invoices due soon.")
    : isOverdue
      ? `${items.length} invoice(s) are past their payment due date. Please review immediately.`
      : `${items.length} invoice(s) are approaching their payment due date.`;

  return card([
    header(titleJa, color),
    subtitle(descJa, descEn),
    ...(hasData ? [
      separator(),
      {
        type: "FactSet",
        facts: items.map((d) => ({
          title: d.payerName,
          value: isOverdue
            ? `${d.amount} — ${Math.abs(d.daysUntilDue)}日超過 / ${Math.abs(d.daysUntilDue)}d overdue`
            : `${d.amount} — ${d.daysUntilDue}日後 / due in ${d.daysUntilDue}d (${d.dueDate})`,
        })),
      },
    ] : []),
  ]);
}
