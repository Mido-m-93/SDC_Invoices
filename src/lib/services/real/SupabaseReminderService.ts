// lib/services/real/SupabaseReminderService.ts
import { createClient } from "@supabase/supabase-js";
import type { IReminderService, INotificationService } from "../types";
import type {
  ReminderType,
  ReminderLog,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ReminderSummary,
  InvoiceStatusCode,
} from "@/types";
import { generateId } from "@/lib/utils";

const STALE_STATUS_CODES: InvoiceStatusCode[] = [
  "REVIEW_REQUIRED",
  "MISSING_ATTACHMENT",
  "PDF_LINK_ERROR",
  "AMOUNT_MISMATCH",
  "PROJECT_INFO_MISSING",
];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Derive due date: end of closingMonth + paymentTermsDays */
function deriveDueDate(closingMonth: string, paymentTermsDays: number): string | null {
  const m = closingMonth.match(/(\d{4})[^\d](\d{1,2})/);
  if (!m) return null;
  const year = parseInt(m[1]);
  const month = parseInt(m[2]);
  // Last day of the closing month
  const lastDay = new Date(year, month, 0); // day 0 of next month = last day of this month
  lastDay.setDate(lastDay.getDate() + paymentTermsDays);
  return lastDay.toISOString().slice(0, 10);
}

function daysBetween(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - now.getTime()) / 86400000);
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export class SupabaseReminderService implements IReminderService {
  constructor(
    private notificationSvc: INotificationService,
    private paymentTermsDays: number = 30
  ) {}

  async detectGaps(month: string): Promise<ReminderGap[]> {
    const db = getSupabase();

    // Month range: "YYYY-MM" → first day of month as ISO date for comparison
    const [year, mon] = month.split("-");
    const monthStart = `${year}-${mon}-01`;
    const monthEnd = new Date(parseInt(year), parseInt(mon), 0).toISOString().slice(0, 10);

    // Active contracts covering this month
    const { data: contracts } = await db
      .from("contracts")
      .select("id, vendor_id, project_name, expected_monthly_amount, currency, start_date, end_date, status")
      .eq("status", "active")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart)
      .gt("expected_monthly_amount", 0);

    if (!contracts?.length) return [];

    // Get vendor names
    const vendorIds = Array.from(new Set(contracts.map((c) => c.vendor_id as string)));
    const { data: vendors } = await db
      .from("vendors")
      .select("id, name, aliases")
      .in("id", vendorIds);

    const vendorMap = new Map(
      (vendors ?? []).map((v) => [v.id, { name: v.name as string, aliases: (v.aliases ?? []) as string[] }])
    );

    // Invoice submissions for this month
    const { data: submissions } = await db
      .from("invoice_submissions")
      .select("payer_name, closing_month")
      .eq("snapshot_month", month);

    const submittedNames = new Set(
      (submissions ?? []).map((s) => normalizeForMatch(s.payer_name ?? ""))
    );

    const gaps: ReminderGap[] = [];

    for (const contract of contracts) {
      const vendor = vendorMap.get(contract.vendor_id);
      if (!vendor) continue;

      const allNames = [vendor.name, ...(vendor.aliases ?? [])].map(normalizeForMatch);
      const submitted = allNames.some((n) => submittedNames.has(n));

      if (!submitted) {
        gaps.push({
          vendorId: contract.vendor_id,
          vendorName: vendor.name,
          contractId: contract.id,
          contractName: contract.project_name,
          expectedAmount: contract.expected_monthly_amount,
          currency: contract.currency ?? "JPY",
        });
      }
    }

    return gaps;
  }

  async detectStaleReviews(thresholdDays: number): Promise<StaleReview[]> {
    const db = getSupabase();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);

    const { data: validations } = await db
      .from("invoice_validations")
      .select("submission_id, status_code, reviewer_recommendation, created_at")
      .in("status_code", STALE_STATUS_CODES)
      .or("human_approved.is.null,human_approved.eq.false")
      .lte("created_at", cutoff.toISOString());

    if (!validations?.length) return [];

    // Get payer names
    const ids = validations.map((v) => v.submission_id);
    const { data: subs } = await db
      .from("invoice_submissions")
      .select("id, payer_name")
      .in("id", ids);

    const nameMap = new Map((subs ?? []).map((s) => [s.id, s.payer_name as string]));

    return validations.map((v) => {
      const createdAt = new Date(v.created_at);
      const staleDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
      return {
        submissionId: v.submission_id,
        payerName: nameMap.get(v.submission_id) ?? "Unknown",
        statusCode: v.status_code as InvoiceStatusCode,
        staleDays,
        reviewer: v.reviewer_recommendation ?? undefined,
      };
    });
  }

  async detectDueDateIssues(thresholdDays: number): Promise<DueDateAlert[]> {
    const db = getSupabase();

    // Get all non-saved submissions
    const { data: submissions } = await db
      .from("invoice_submissions")
      .select("id, payer_name, closing_month, claimed_amount_tax_included");

    if (!submissions?.length) return [];

    // Get filed submission IDs (already saved = skip)
    const ids = submissions.map((s) => s.id);
    const { data: filed } = await db
      .from("filed_documents")
      .select("submission_id")
      .in("submission_id", ids);

    const savedIds = new Set((filed ?? []).map((f) => f.submission_id));

    const alerts: DueDateAlert[] = [];

    for (const sub of submissions) {
      if (savedIds.has(sub.id)) continue;
      if (!sub.closing_month) continue;

      const dueDate = deriveDueDate(sub.closing_month, this.paymentTermsDays);
      if (!dueDate) continue;

      const daysUntilDue = daysBetween(dueDate);

      if (daysUntilDue <= thresholdDays) {
        alerts.push({
          submissionId: sub.id,
          payerName: sub.payer_name ?? "Unknown",
          dueDate,
          daysUntilDue,
          amount: sub.claimed_amount_tax_included ?? "—",
        });
      }
    }

    return alerts.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }

  async sendReminders(
    month: string,
    type: ReminderType | "all"
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const db = getSupabase();
    const types: ReminderType[] =
      type === "all"
        ? ["missing_invoice", "stale_review", "due_date_approaching", "due_date_overdue"]
        : [type];

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const t of types) {
      let payload: unknown = null;

      if (t === "missing_invoice") {
        const gaps = await this.detectGaps(month);
        if (!gaps.length) { skipped++; continue; }
        payload = { gaps, month };
      } else if (t === "stale_review") {
        const stale = await this.detectStaleReviews(3);
        if (!stale.length) { skipped++; continue; }
        payload = { stale };
      } else if (t === "due_date_approaching") {
        const due = (await this.detectDueDateIssues(5)).filter((d) => d.daysUntilDue >= 0);
        if (!due.length) { skipped++; continue; }
        payload = { due };
      } else if (t === "due_date_overdue") {
        const overdue = (await this.detectDueDateIssues(0)).filter((d) => d.daysUntilDue < 0);
        if (!overdue.length) { skipped++; continue; }
        payload = { overdue };
      }

      const ok = await this.notificationSvc.sendReminder({ type: t, payload });
      const log: ReminderLog = {
        id: generateId(),
        reminderType: t,
        targetMonth: month,
        sentAt: new Date().toISOString(),
        channel: "teams",
        status: ok ? "sent" : "failed",
        message: ok ? `Sent ${t}` : `Failed to send ${t}`,
      };

      await db.from("reminder_logs").insert({
        id: log.id,
        reminder_type: log.reminderType,
        target_month: log.targetMonth,
        sent_at: log.sentAt,
        channel: log.channel,
        status: log.status,
        message: log.message,
      });

      if (ok) sent++; else failed++;
    }

    return { sent, failed, skipped };
  }

  async getSummary(month: string): Promise<ReminderSummary> {
    const [gaps, stale, dueAll, logs] = await Promise.all([
      this.detectGaps(month),
      this.detectStaleReviews(3),
      this.detectDueDateIssues(5),
      this.getLogs(month),
    ]);

    const approaching = dueAll.filter((d) => d.daysUntilDue >= 0);
    const overdue = dueAll.filter((d) => d.daysUntilDue < 0);
    const oldestDays = stale.length > 0 ? Math.max(...stale.map((s) => s.staleDays)) : 0;

    // Total expected submissions = active contracts for month
    const db = getSupabase();
    const [year, mon] = month.split("-");
    const monthEnd = new Date(parseInt(year), parseInt(mon), 0).toISOString().slice(0, 10);
    const { count: contractCount } = await db
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .lte("start_date", monthEnd)
      .gte("end_date", `${year}-${mon}-01`);

    const lastSent = logs.length > 0 ? logs[0].sentAt : null;

    return {
      missingInvoice: { count: gaps.length, total: contractCount ?? gaps.length },
      staleReview: { count: stale.length, oldestDays },
      dueDateApproaching: { count: approaching.length },
      dueDateOverdue: { count: overdue.length },
      lastSent,
      recentLogs: logs.slice(0, 10),
    };
  }

  async getLogs(month: string): Promise<ReminderLog[]> {
    const db = getSupabase();
    const { data } = await db
      .from("reminder_logs")
      .select("*")
      .eq("target_month", month)
      .order("sent_at", { ascending: false })
      .limit(50);

    return (data ?? []).map((r) => ({
      id: r.id,
      reminderType: r.reminder_type as ReminderType,
      targetMonth: r.target_month,
      vendorId: r.vendor_id ?? undefined,
      submissionId: r.submission_id ?? undefined,
      contractId: r.contract_id ?? undefined,
      sentAt: r.sent_at,
      channel: r.channel as "teams" | "mock",
      status: r.status as "sent" | "failed" | "skipped",
      message: r.message,
    }));
  }
}
