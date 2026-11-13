import type { INotificationService } from "../types";
import type {
  ReminderType,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ExpiredContractAlert,
} from "@/types";

// Posts reminders to a Slack incoming webhook. The message content mirrors the
// Teams cards (TeamsNotificationService), in Slack's mrkdwn text format.
export class SlackNotificationService implements INotificationService {
  constructor(private webhookUrl: string) {}

  async sendReminder(data: { type: ReminderType; payload: unknown }): Promise<boolean> {
    try {
      const text = buildSlackText(data.type, data.payload);
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        cache: "no-store",
      });
      if (!res.ok) {
        // Retry once, like the Teams sender
        await new Promise((r) => setTimeout(r, 1000));
        const retry = await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          cache: "no-store",
        });
        return retry.ok;
      }
      return true;
    } catch (err) {
      console.error("[SlackNotification] sendReminder failed:", err);
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
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:
            "🔔 *SDC Invoice Tool — Connection Test*\n" +
            "Slack通知の設定が完了しました。リマインダー通知が正常に届いています。\n" +
            "Slack notifications are configured. Reminders will be delivered to this channel.",
        }),
        cache: "no-store",
      });
      return res.ok
        ? { ok: true, message: "テスト通知を送信しました / Test notification sent" }
        : { ok: false, message: `Slack webhook responded with HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }
}

// ── Message building ─────────────────────────────────────────────────────────

const MAX_LIST_ITEMS = 20;

// Slack treats &, < and > in text as control characters (and <!channel> as an
// @-mention), and names here come from public forms, so escape them.
export function escapeSlack(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bullets(lines: string[]): string {
  const shown = lines.slice(0, MAX_LIST_ITEMS).map((l) => `• ${l}`);
  if (lines.length > MAX_LIST_ITEMS) shown.push(`…他 ${lines.length - MAX_LIST_ITEMS}件 / and ${lines.length - MAX_LIST_ITEMS} more`);
  return shown.join("\n");
}

function section(title: string, description: string, lines: string[]): string {
  return [`*${title}*`, description, ...(lines.length ? [bullets(lines)] : [])].join("\n");
}

interface SummaryPayload {
  month?: string;
  gaps?: ReminderGap[];
  stale?: StaleReview[];
  approaching?: DueDateAlert[];
  overdue?: DueDateAlert[];
  pendingExpenses?: number;
  expiredContracts?: ExpiredContractAlert[];
}

function buildSummaryText(p: SummaryPayload): string {
  const gaps = p.gaps ?? [];
  const stale = p.stale ?? [];
  const approaching = p.approaching ?? [];
  const overdue = p.overdue ?? [];
  const pendingExpenses = p.pendingExpenses ?? 0;
  const expired = p.expiredContracts ?? [];
  const expiredClient = expired.filter((a) => a.kind === "contract");
  const expiredMembers = expired.filter((a) => a.kind === "member");
  const allClear = !gaps.length && !stale.length && !approaching.length && !overdue.length && !pendingExpenses && !expired.length;

  const none = "✅ なし / None";
  const count = (n: number, unit: string) => (n ? `${n}件 / ${n} ${unit}` : none);

  return [
    `📊 *SDC 日次サマリー / Daily Summary — ${escapeSlack(p.month)}*`,
    allClear ? "すべて問題ありません。 / Everything looks good." : "確認が必要な項目があります。 / Some items require attention.",
    "",
    `• 📋 未提出 / Missing Submissions: ${count(gaps.length, "vendor(s)")}`,
    `• ⏳ 承認待ち / Stale Reviews: ${count(stale.length, "invoice(s)")}`,
    `• ⚠️ 期日接近 / Due Soon: ${count(approaching.length, "invoice(s)")}`,
    `• 🚨 期日超過 / Overdue: ${count(overdue.length, "invoice(s)")}`,
    `• 🧾 経費承認待ち / Pending Expenses: ${count(pendingExpenses, "claim(s)")}`,
    `• 📄 クライアント契約期限切れ / Expired Client Contracts: ${count(expiredClient.length, "contract(s)")}`,
    `• 👤 メンバー契約期限切れ / Expired Member Contracts: ${count(expiredMembers.length, "contract(s)")}`,
  ].join("\n");
}

export function buildSlackText(type: ReminderType, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;

  // The "all" reminder sends one combined summary (flagged with _summary)
  if (p._summary) return buildSummaryText(p as SummaryPayload);

  switch (type) {
    case "missing_invoice": {
      const gaps = (p.gaps as ReminderGap[] | undefined) ?? [];
      return section(
        `📋 未提出請求書 / Missing Invoices — ${escapeSlack(p.month)}`,
        gaps.length
          ? `${gaps.length}件のベンダーが今月の請求書を提出していません。 / ${gaps.length} vendor(s) have not submitted their invoice this month.`
          : "✅ 全員提出済みです。 / All vendors have submitted.",
        gaps.map((g) => `${escapeSlack(g.vendorName)}: ¥${Number(g.expectedAmount ?? 0).toLocaleString("ja-JP")} — ${escapeSlack(g.contractName)}`)
      );
    }
    case "stale_review": {
      const stale = (p.stale as StaleReview[] | undefined) ?? [];
      return section(
        "⏳ 承認待ち・不備 / Stale Reviews",
        stale.length
          ? `${stale.length}件の請求書が確認待ちです。 / ${stale.length} invoice(s) are pending review.`
          : "✅ 滞留している請求書はありません。 / No invoices are awaiting review.",
        stale.map((s) => `${escapeSlack(s.payerName)}: ${escapeSlack(s.statusCode)} — ${s.staleDays}日滞留 / ${s.staleDays}d stale`)
      );
    }
    case "due_date_approaching": {
      const due = (p.due as DueDateAlert[] | undefined) ?? [];
      return section(
        "⚠️ 支払期日接近 / Due Date Alert",
        due.length
          ? `${due.length}件の請求書の支払期日が近づいています。 / ${due.length} invoice(s) are approaching their payment due date.`
          : "✅ 期日が近い請求書はありません。 / No invoices due soon.",
        due.map((d) => `${escapeSlack(d.payerName)}: ${escapeSlack(d.amount)} — ${d.daysUntilDue}日後 / due in ${d.daysUntilDue}d (${escapeSlack(d.dueDate)})`)
      );
    }
    case "due_date_overdue": {
      const overdue = (p.overdue as DueDateAlert[] | undefined) ?? [];
      return section(
        "🚨 支払期日超過 / Payment Overdue",
        overdue.length
          ? `${overdue.length}件の請求書の支払期日が超過しています。至急確認してください。 / ${overdue.length} invoice(s) are past their payment due date. Please review immediately.`
          : "✅ 期日超過の請求書はありません。 / No overdue invoices.",
        overdue.map((d) => `${escapeSlack(d.payerName)}: ${escapeSlack(d.amount)} — ${Math.abs(d.daysUntilDue)}日超過 / ${Math.abs(d.daysUntilDue)}d overdue`)
      );
    }
    case "contract_expired": {
      const items = (p.items as ExpiredContractAlert[] | undefined) ?? [];
      return section(
        "📄 契約期限切れ / Expired Contracts",
        items.length
          ? `${items.length}件の契約・メンバーの終了日が過ぎていますが、まだ有効として登録されています。 / ${items.length} contract(s)/member(s) are still marked active past their end date.`
          : "✅ 期限切れの契約はありません。 / No contracts are past their end date.",
        items.map((i) => `${i.kind === "member" ? "👤" : "📄"} ${escapeSlack(i.name)}: ended ${escapeSlack(i.endDate)}`)
      );
    }
    case "escalation":
      return `🚨 *エスカレーション / Escalation Required* — ${escapeSlack(p.payerName ?? "unknown")} の請求書が ${escapeSlack(p.blockedDays ?? "?")} 日間ブロックされています。 / Invoice from ${escapeSlack(p.payerName ?? "unknown")} has been BLOCKED for ${escapeSlack(p.blockedDays ?? "?")} days. Immediate review needed.`;
    default:
      return `📋 SDC Invoice Tool notification: ${escapeSlack(type)}`;
  }
}
