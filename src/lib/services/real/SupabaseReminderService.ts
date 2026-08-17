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
import { TeamsNotificationService } from "./TeamsNotificationService";

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
export function deriveDueDate(closingMonth: string, paymentTermsDays: number): string | null {
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

  /** Resolve the live notification service: prefer Teams if webhook URL is in app_config */
  private async resolveNotificationSvc(): Promise<INotificationService> {
    try {
      const db = getSupabase();
      const { data } = await db
        .from("app_config")
        .select("teams_webhook_url")
        .eq("id", "main")
        .single();
      const url = data?.teams_webhook_url as string | undefined;
      if (url && url.startsWith("https://")) {
        return new TeamsNotificationService(url);
      }
    } catch {
      // fall through to injected service
    }
    return this.notificationSvc;
  }

  async sendReminders(
    month: string,
    type: ReminderType | "all"
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const db = getSupabase();
    // Always read webhook URL fresh from DB so config-page changes take effect immediately
    const notifSvc = await this.resolveNotificationSvc();

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // "all" → always send one summary card with all counts (even if 0)
    if (type === "all") {
      const db2 = getSupabase();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);
      const [gaps, stale, dueAll, expenseStaleResult] = await Promise.all([
        this.detectGaps(month),
        this.detectStaleReviews(3),
        this.detectDueDateIssues(5),
        db2.from("expense_claims").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]).lte("submitted_at", cutoff.toISOString()),
      ]);
      const approaching = dueAll.filter((d) => d.daysUntilDue >= 0);
      const overdue = dueAll.filter((d) => d.daysUntilDue < 0);
      const payload = { month, gaps, stale, approaching, overdue, staleExpenses: expenseStaleResult.count ?? 0 };
      const ok = await notifSvc.sendReminder({ type: "missing_invoice" as ReminderType, payload: { _summary: true, ...payload } });
      if (ok) sent++; else failed++;
      await this._logReminder(db, "missing_invoice", month, "teams", ok, "Monthly summary");
      return { sent, failed, skipped };
    }

    // Individual types always send (with data or "all clear")
    let payload: unknown = null;

    if (type === "missing_invoice") {
      const gaps = await this.detectGaps(month);
      payload = { gaps, month };
    } else if (type === "stale_review") {
      const stale = await this.detectStaleReviews(3);
      payload = { stale };
    } else if (type === "due_date_approaching") {
      const due = (await this.detectDueDateIssues(5)).filter((d) => d.daysUntilDue >= 0);
      payload = { due };
    } else if (type === "due_date_overdue") {
      const overdue = (await this.detectDueDateIssues(0)).filter((d) => d.daysUntilDue < 0);
      payload = { overdue };
    } else if (type === "missing_expense_receipt") {
      const db = getSupabase();
      const { data } = await db
        .from("expense_claims")
        .select("id, submitted_by, amount, currency, expense_date")
        .in("status", ["submitted", "under_review"])
        .eq("receipt_url", "");
      payload = { missing: data ?? [] };
    } else if (type === "stale_expense_review") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);
      const db = getSupabase();
      const { data } = await db
        .from("expense_claims")
        .select("id, submitted_by, amount, currency, submitted_at")
        .in("status", ["submitted", "under_review"])
        .lte("submitted_at", cutoff.toISOString());
      payload = { stale: data ?? [] };
    }

    const ok = await notifSvc.sendReminder({ type, payload });
    await this._logReminder(db, type, month, "teams", ok, ok ? `Sent ${type}` : `Failed to send ${type}`);
    if (ok) sent++; else failed++;

    return { sent, failed, skipped };
  }

  private async _logReminder(
    _db: ReturnType<typeof getSupabase>,
    type: ReminderType,
    month: string,
    channel: "teams" | "mock",
    ok: boolean,
    message: string
  ) {
    // Use direct REST fetch — avoids Supabase JS client WebSocket issues in Next.js
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;

      await fetch(`${url}/rest/v1/reminder_logs`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          reminder_type: type,
          target_month: month,
          sent_at: new Date().toISOString(),
          channel,
          status: ok ? "sent" : "failed",
          message,
        }),
        cache: "no-store",
      });
    } catch (err) {
      console.error("[ReminderService] log insert failed:", err);
    }
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
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return [];

      const res = await fetch(
        `${url}/rest/v1/reminder_logs?target_month=eq.${encodeURIComponent(month)}&order=sent_at.desc&limit=50`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          cache: "no-store",
        }
      );
      const data: Record<string, unknown>[] = await res.json();
      return (Array.isArray(data) ? data : []).map((r) => ({
        id: r.id as string,
        reminderType: r.reminder_type as ReminderType,
        targetMonth: r.target_month as string,
        vendorId: r.vendor_id as string | undefined,
        submissionId: r.submission_id as string | undefined,
        contractId: r.contract_id as string | undefined,
        sentAt: r.sent_at as string,
        channel: r.channel as "teams" | "mock",
        status: r.status as "sent" | "failed" | "skipped",
        message: r.message as string,
      }));
    } catch {
      return [];
    }
  }
}
