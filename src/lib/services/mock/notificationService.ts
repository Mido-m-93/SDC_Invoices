// lib/services/mock/notificationService.ts
import type { INotificationService } from "../types";
import type { ReminderType } from "@/types";

const _sent: Array<{ type: ReminderType; payload: unknown; sentAt: string }> = [];

export class MockNotificationService implements INotificationService {
  async sendReminder(data: { type: ReminderType; payload: unknown }): Promise<boolean> {
    const entry = { ...data, sentAt: new Date().toISOString() };
    _sent.push(entry);
    console.log(`[MockNotification] sendReminder type=${data.type}`, data.payload);
    return true;
  }

  async sendBatch(
    reminders: Array<{ type: ReminderType; payload: unknown }>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    for (const r of reminders) {
      const ok = await this.sendReminder(r);
      if (ok) sent++;
    }
    return { sent, failed: reminders.length - sent };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    console.log("[MockNotification] testConnection → OK");
    return { ok: true, message: "Mock: connection OK (no real webhook configured)" };
  }

  /** Expose sent history for testing */
  getSentHistory() {
    return [..._sent];
  }
}
