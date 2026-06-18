import type { INotificationService } from "../types";
import type { ReminderType } from "@/types";

// Sends to all configured channels simultaneously (Teams + Slack + Email).
// Channels with missing config are silently skipped.
export class MultiChannelNotificationService implements INotificationService {
  private channels: INotificationService[];

  constructor(channels: INotificationService[]) {
    this.channels = channels;
  }

  async sendReminder(data: { type: ReminderType; payload: unknown }): Promise<boolean> {
    const results = await Promise.all(this.channels.map((ch) => ch.sendReminder(data)));
    return results.some(Boolean);
  }

  async sendBatch(
    reminders: Array<{ type: ReminderType; payload: unknown }>
  ): Promise<{ sent: number; failed: number }> {
    const allResults = await Promise.all(
      this.channels.map((ch) => ch.sendBatch(reminders))
    );
    // Report the best outcome across all channels
    const sent   = Math.max(...allResults.map((r) => r.sent), 0);
    const failed = Math.min(...allResults.map((r) => r.failed), reminders.length);
    return { sent, failed };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const results = await Promise.all(
      this.channels.map((ch) => ch.testConnection())
    );
    const messages = results.map((r, i) => `[Ch${i + 1}] ${r.ok ? "✓" : "✗"} ${r.message}`);
    return {
      ok: results.some((r) => r.ok),
      message: messages.join(" | "),
    };
  }
}
