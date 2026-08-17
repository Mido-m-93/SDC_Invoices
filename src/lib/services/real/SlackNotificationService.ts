import type { INotificationService } from "../types";
import type { ReminderType } from "@/types";

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
      return res.ok;
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
        body: JSON.stringify({ text: "✅ SDC Invoice Tool — Slack connection test successful" }),
        cache: "no-store",
      });
      return res.ok
        ? { ok: true, message: "Slack test notification sent" }
        : { ok: false, message: "Slack webhook responded with an error" };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }
}

function buildSlackText(type: ReminderType, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case "missing_invoice":
      return `⚠️ *Invoice Not Submitted* — ${p.vendorName ?? "Unknown vendor"} has not submitted an invoice for ${p.month ?? "this month"}.`;
    case "stale_review":
      return `🕐 *Stale Review* — Invoice from ${p.payerName ?? "unknown"} has been waiting for review for ${p.staleDays ?? "?"} days.`;
    case "due_date_approaching":
      return `🔔 *Payment Due Soon* — Invoice from ${p.payerName ?? "unknown"} is due in ${p.daysUntilDue ?? "?"} days (${p.dueDate ?? ""}).`;
    case "due_date_overdue":
      return `🚨 *Payment Overdue* — Invoice from ${p.payerName ?? "unknown"} was due on ${p.dueDate ?? "unknown date"}.`;
    case "escalation":
      return `🚨 *Escalation Required* — Invoice from ${p.payerName ?? "unknown"} has been BLOCKED for ${p.blockedDays ?? "?"} days. Immediate review needed.`;
    default:
      return `📋 SDC Invoice Tool notification: ${type}`;
  }
}
