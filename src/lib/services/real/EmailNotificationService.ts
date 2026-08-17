import type { INotificationService } from "../types";
import type { ReminderType } from "@/types";

// Sends email via Resend API (https://resend.com)
// Required env vars:
//   RESEND_API_KEY     — from Resend dashboard
//   NOTIFICATION_FROM  — verified sender address (e.g. noreply@roboco-op.org)
//   NOTIFICATION_TO    — recipient address (e.g. accounting@roboco-op.org)

const RESEND_API = "https://api.resend.com/emails";

export class EmailNotificationService implements INotificationService {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly to: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? "";
    this.from   = process.env.NOTIFICATION_FROM ?? "noreply@roboco-op.org";
    this.to     = process.env.NOTIFICATION_TO   ?? "";
  }

  async sendReminder(data: { type: ReminderType; payload: unknown }): Promise<boolean> {
    if (!this.apiKey || !this.to) return false;
    try {
      const { subject, html } = buildEmail(data.type, data.payload);
      const res = await fetch(RESEND_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: this.from, to: [this.to], subject, html }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("[EmailNotification] Resend error:", err);
      }
      return res.ok;
    } catch (err) {
      console.error("[EmailNotification] sendReminder failed:", err);
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
    }
    return { sent, failed };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) return { ok: false, message: "RESEND_API_KEY not configured" };
    if (!this.to)     return { ok: false, message: "NOTIFICATION_TO not configured" };
    const ok = await this.sendReminder({
      type: "missing_invoice",
      payload: { vendorName: "Test Vendor", month: "2026-06" },
    });
    return ok
      ? { ok: true, message: `Test email sent to ${this.to}` }
      : { ok: false, message: "Email send failed — check RESEND_API_KEY" };
  }
}

function buildEmail(type: ReminderType, payload: unknown): { subject: string; html: string } {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case "missing_invoice":
      return {
        subject: `[SDC] Invoice Not Submitted — ${p.vendorName ?? "Unknown"} (${p.month ?? ""})`,
        html: `<p><strong>${p.vendorName}</strong> has not submitted an invoice for <strong>${p.month}</strong>.</p>`,
      };
    case "stale_review":
      return {
        subject: `[SDC] Stale Review — ${p.payerName ?? "Unknown"} (${p.staleDays ?? "?"} days)`,
        html: `<p>Invoice from <strong>${p.payerName}</strong> has been waiting for review for <strong>${p.staleDays} days</strong>.</p>`,
      };
    case "due_date_approaching":
      return {
        subject: `[SDC] Payment Due Soon — ${p.payerName ?? "Unknown"} (${p.dueDate ?? ""})`,
        html: `<p>Invoice from <strong>${p.payerName}</strong> is due in <strong>${p.daysUntilDue} days</strong> on ${p.dueDate}.</p>`,
      };
    case "due_date_overdue":
      return {
        subject: `[SDC] OVERDUE Payment — ${p.payerName ?? "Unknown"}`,
        html: `<p style="color:red">Invoice from <strong>${p.payerName}</strong> was due on <strong>${p.dueDate}</strong> and is now overdue.</p>`,
      };
    case "escalation":
      return {
        subject: `[SDC] ESCALATION — ${p.payerName ?? "Unknown"} blocked for ${p.blockedDays ?? "?"} days`,
        html: `<p style="color:red"><strong>Escalation required.</strong> Invoice from <strong>${p.payerName}</strong> has been BLOCKED for <strong>${p.blockedDays} days</strong> and needs immediate review.</p>`,
      };
    default:
      return {
        subject: `[SDC] Invoice Notification: ${type}`,
        html: `<p>SDC Invoice Tool notification: ${type}</p>`,
      };
  }
}
