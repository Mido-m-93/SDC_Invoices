// lib/services/mock/reminderService.ts
import type { IReminderService, INotificationService } from "../types";
import type {
  ReminderType,
  ReminderLog,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ReminderSummary,
} from "@/types";
import { generateId } from "@/lib/utils";

const _logs: ReminderLog[] = [];

const MOCK_GAPS: ReminderGap[] = [
  {
    vendorId: "vendor-mock-1",
    vendorName: "株式会社サンプルA",
    contractId: "contract-mock-1",
    contractName: "月次業務委託契約A",
    expectedAmount: 300000,
    currency: "JPY",
  },
  {
    vendorId: "vendor-mock-2",
    vendorName: "山田 太郎",
    contractId: "contract-mock-2",
    contractName: "デザイン業務委託",
    expectedAmount: 150000,
    currency: "JPY",
  },
];

const MOCK_STALE: StaleReview[] = [
  {
    submissionId: "sub-mock-stale-1",
    payerName: "田中 花子",
    statusCode: "REVIEW_REQUIRED",
    staleDays: 5,
    reviewer: "accounting@roboco-op.org",
  },
];

const MOCK_DUE: DueDateAlert[] = [
  {
    submissionId: "sub-mock-due-1",
    payerName: "鈴木 一郎",
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    daysUntilDue: 3,
    amount: "¥200,000",
  },
  {
    submissionId: "sub-mock-overdue-1",
    payerName: "佐藤 次郎",
    dueDate: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    daysUntilDue: -2,
    amount: "¥85,000",
  },
];

export class MockReminderService implements IReminderService {
  constructor(private notificationSvc: INotificationService) {}

  async detectGaps(_month: string): Promise<ReminderGap[]> {
    return [...MOCK_GAPS];
  }

  async detectStaleReviews(_thresholdDays: number): Promise<StaleReview[]> {
    return [...MOCK_STALE];
  }

  async detectDueDateIssues(_thresholdDays: number): Promise<DueDateAlert[]> {
    return [...MOCK_DUE];
  }

  async sendReminders(
    month: string,
    type: ReminderType | "all"
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const types: ReminderType[] =
      type === "all"
        ? ["missing_invoice", "stale_review", "due_date_approaching", "due_date_overdue"]
        : [type];

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const t of types) {
      let payload: unknown = null;
      let hasData = false;

      if (t === "missing_invoice") {
        const gaps = await this.detectGaps(month);
        if (gaps.length === 0) { skipped++; continue; }
        payload = { gaps, month };
        hasData = true;
      } else if (t === "stale_review") {
        const stale = await this.detectStaleReviews(3);
        if (stale.length === 0) { skipped++; continue; }
        payload = { stale };
        hasData = true;
      } else if (t === "due_date_approaching") {
        const due = (await this.detectDueDateIssues(5)).filter((d) => d.daysUntilDue >= 0);
        if (due.length === 0) { skipped++; continue; }
        payload = { due };
        hasData = true;
      } else if (t === "due_date_overdue") {
        const overdue = (await this.detectDueDateIssues(0)).filter((d) => d.daysUntilDue < 0);
        if (overdue.length === 0) { skipped++; continue; }
        payload = { overdue };
        hasData = true;
      }

      if (!hasData) { skipped++; continue; }

      const ok = await this.notificationSvc.sendReminder({ type: t, payload });
      const log: ReminderLog = {
        id: generateId(),
        reminderType: t,
        targetMonth: month,
        sentAt: new Date().toISOString(),
        channel: "mock",
        status: ok ? "sent" : "failed",
        message: ok ? `Sent ${t} reminder` : `Failed to send ${t} reminder`,
      };
      _logs.unshift(log);
      if (ok) sent++; else failed++;
    }

    return { sent, failed, skipped };
  }

  async getSummary(month: string): Promise<ReminderSummary> {
    const [gaps, stale, dueAll] = await Promise.all([
      this.detectGaps(month),
      this.detectStaleReviews(3),
      this.detectDueDateIssues(5),
    ]);

    const approaching = dueAll.filter((d) => d.daysUntilDue >= 0);
    const overdue = dueAll.filter((d) => d.daysUntilDue < 0);
    const oldestDays = stale.length > 0 ? Math.max(...stale.map((s) => s.staleDays)) : 0;
    const monthLogs = _logs.filter((l) => l.targetMonth === month);
    const lastSent = monthLogs.length > 0 ? monthLogs[0].sentAt : null;

    return {
      missingInvoice: { count: gaps.length, total: gaps.length + 6 },
      staleReview: { count: stale.length, oldestDays },
      dueDateApproaching: { count: approaching.length },
      dueDateOverdue: { count: overdue.length },
      pendingExpenses: { count: 0 },
      lastSent,
      recentLogs: monthLogs.slice(0, 10),
    };
  }

  async getLogs(month: string): Promise<ReminderLog[]> {
    return _logs.filter((l) => l.targetMonth === month);
  }
}
