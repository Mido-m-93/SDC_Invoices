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
        // Retry once
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
      // Brief pause between messages to avoid rate limiting
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

// ── Adaptive Card builders ────────────────────────────────────────────────────

function buildTestCard() {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: [
            { type: "TextBlock", text: "🔔 SDC Invoice Tool — テスト通知", weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text: "Teams通知の設定が完了しました。リマインダー通知が正常に届いています。", wrap: true },
          ],
        },
      },
    ],
  };
}

function buildAdaptiveCard(type: ReminderType, payload: unknown) {
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

function buildMissingInvoiceCard(payload: { gaps: ReminderGap[]; month: string }) {
  const rows = payload.gaps.map((g) => ({
    type: "ColumnSet",
    columns: [
      { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: g.vendorName, wrap: true }] },
      { type: "Column", width: "auto", items: [{ type: "TextBlock", text: `¥${g.expectedAmount.toLocaleString("ja-JP")}`, color: "Attention" }] },
    ],
  }));

  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body: [
          { type: "TextBlock", text: `📋 未提出請求書リマインダー — ${payload.month}`, weight: "Bolder", size: "Medium", color: "Accent" },
          { type: "TextBlock", text: `${payload.gaps.length}件のベンダーが今月の請求書を提出していません。`, wrap: true },
          { type: "FactSet", facts: payload.gaps.map((g) => ({ title: g.vendorName, value: `¥${g.expectedAmount.toLocaleString("ja-JP")} (${g.contractName})` })) },
        ],
      },
    }],
  };
}

function buildStaleReviewCard(payload: { stale: StaleReview[] }) {
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body: [
          { type: "TextBlock", text: "⏳ 承認待ち・不備リマインダー", weight: "Bolder", size: "Medium", color: "Warning" },
          { type: "TextBlock", text: `${payload.stale.length}件の請求書が確認待ちです。`, wrap: true },
          { type: "FactSet", facts: payload.stale.map((s) => ({ title: s.payerName, value: `${s.statusCode} — ${s.staleDays}日滞留` })) },
        ],
      },
    }],
  };
}

function buildDueDateCard(payload: { due?: DueDateAlert[]; overdue?: DueDateAlert[] }, isOverdue: boolean) {
  const items = payload.due ?? payload.overdue ?? [];
  const title = isOverdue ? "🚨 支払期日超過 — エスカレーション" : "⚠️ 支払期日接近アラート";
  const color = isOverdue ? "Attention" : "Warning";
  const desc = isOverdue
    ? `${items.length}件の請求書の支払期日が超過しています。至急確認してください。`
    : `${items.length}件の請求書の支払期日が近づいています。`;

  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body: [
          { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", color },
          { type: "TextBlock", text: desc, wrap: true },
          { type: "FactSet", facts: items.map((d) => ({
            title: d.payerName,
            value: isOverdue
              ? `${d.amount} — ${Math.abs(d.daysUntilDue)}日超過`
              : `${d.amount} — ${d.daysUntilDue}日後 (${d.dueDate})`,
          })) },
        ],
      },
    }],
  };
}
