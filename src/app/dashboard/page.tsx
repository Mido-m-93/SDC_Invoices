"use client";
// src/app/dashboard/page.tsx

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import MonthSelector from "@/components/ui/MonthSelector";
import StatusBadge from "@/components/ui/StatusBadge";
import InvoiceDetailPanel from "@/components/invoice/InvoiceDetailPanel";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import {
  fetchDashboardStats,
  validateInvoiceBatch,
  fetchInvoices,
  fileInvoiceBulk,
  fetchValidationResults,
  fetchFiledDocuments,
  fetchAvailableMonths,
  approveInvoice,
  fetchReminderSummary,
  sendReminders,
} from "@/lib/api/client";
import { monthOptions, formatTimestamp, formatCurrency } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { SHOW_DASHBOARD_NO_DATA_BANNER } from "@/lib/featureFlags";
import type { DashboardStats, InvoiceListItem, ReminderSummary, ReminderType, ExpenseClaim, Client, Proposal, Lead } from "@/types";
import type { TranslationKey } from "@/translations";
import clsx from "clsx";

const REMINDER_TYPE_KEY: Record<ReminderType, TranslationKey> = {
  missing_invoice: "reminder_missing_invoice",
  stale_review: "reminder_stale_review",
  due_date_approaching: "reminder_due_approaching",
  due_date_overdue: "reminder_due_overdue",
  missing_expense_receipt: "reminder_missing_expense_receipt",
  stale_expense_review: "reminder_stale_expense_review",
  escalation: "reminder_escalation",
};

export default function DashboardPage() {
  const { t, language } = useLanguage();
  const { user } = useCurrentUser();
  const { notify } = useNotifications();
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceListItem[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InvoiceListItem | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [reminderSummary, setReminderSummary] = useState<ReminderSummary | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [moduleData, setModuleData] = useState<{
    expenses: { total: number; submitted: number; underReview: number; violations: number; pendingAmount: number } | null;
    clients:  { total: number; active: number; prospects: number } | null;
    proposals: { total: number; open: number; accepted: number } | null;
    leads:    { total: number; newCount: number; pipelineValue: number } | null;
  }>({ expenses: null, clients: null, proposals: null, leads: null });

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDashboardStats(month);
      setStats(data);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  const loadInvoiceList = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { submissions, sheetsWarning: sw } = await fetchInvoices(month);
      if (sw) setError(t("dashboard_forms_sync_warning").replace("{warning}", sw));
      const ids = submissions.map((s) => s.id);
      const [validations, filedDocs] = await Promise.all([
        fetchValidationResults(ids),
        fetchFiledDocuments(ids),
      ]);
      const validationMap = Object.fromEntries(validations.map((v) => [v.submissionId, v]));
      const filedMap = Object.fromEntries(filedDocs.map((fd) => [fd.submissionId, fd]));
      setInvoiceItems(
        submissions.map((s) => ({
          submission: s,
          validation: validationMap[s.id] ?? null,
          filedDocument: filedMap[s.id] ?? null,
        }))
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setInvoicesLoading(false);
    }
  }, [month]);

  const handleLoadInvoices = useCallback(async () => {
    setError(null);
    try {
      // 1. Sync invoices from source (saves to storage)
      await loadInvoiceList();
      // 2. Refresh stats from the now-updated storage + available months
      const [, months] = await Promise.all([
        loadStats(),
        fetchAvailableMonths().catch(() => [] as string[]),
      ]);
      if (months.length > 0) setAvailableMonths(months);
      notify("success", language === "ja" ? `${month} の請求書を読み込みました` : `Invoices loaded for ${month}`, "/dashboard");
    } catch (err) {
      notify("error", language === "ja" ? `請求書の読み込みに失敗しました: ${String(err)}` : `Failed to load invoices: ${String(err)}`, "/dashboard");
    }
  }, [loadStats, loadInvoiceList, notify, language, month]);

  const drawerRef = useRef<HTMLDivElement | null>(null);

  const handleCardClick = (filter: string) => {
    if (activeFilter === filter) {
      setActiveFilter(null);
      return;
    }
    setActiveFilter(filter);
    // Always reload so the drawer reflects any rows added since the last load
    loadInvoiceList();
  };

  // On mount: fetch available months; if none, stay on current month
  useEffect(() => {
    fetchAvailableMonths().then((months) => {
      setAvailableMonths(months);
      if (months.length > 0) {
        // Pick the most recent month that has data, but prefer current month if it has data
        const current = monthOptions(1)[0];
        setMonth(months.includes(current) ? current : months[0]);
      }
      // If no months have data yet, leave the selector on the current month (default)
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Load cross-module summary counts (non-blocking, best-effort)
  useEffect(() => {
    async function load() {
      const [expRes, clientRes, proposalRes, leadRes] = await Promise.allSettled([
        fetch("/api/expenses").then((r) => r.json() as Promise<{ claims: ExpenseClaim[] }>),
        fetch("/api/clients").then((r) => r.json() as Promise<{ clients: Client[] }>),
        fetch("/api/proposals").then((r) => r.json() as Promise<{ proposals: Proposal[] }>),
        fetch("/api/leads").then((r) => r.json() as Promise<{ leads: Lead[] }>),
      ]);
      setModuleData({
        expenses: expRes.status === "fulfilled" ? (() => {
          const cs = expRes.value.claims ?? [];
          return {
            total:         cs.length,
            submitted:     cs.filter((c) => c.status === "submitted").length,
            underReview:   cs.filter((c) => c.status === "under_review").length,
            violations:    cs.filter((c) => c.policyViolations.length > 0).length,
            pendingAmount: cs.filter((c) => ["submitted","under_review"].includes(c.status))
                             .reduce((s, c) => s + c.amount, 0),
          };
        })() : null,
        clients: clientRes.status === "fulfilled" ? (() => {
          const cs = clientRes.value.clients ?? [];
          return { total: cs.length, active: cs.filter((c) => c.status === "active").length, prospects: cs.filter((c) => c.status === "prospect").length };
        })() : null,
        proposals: proposalRes.status === "fulfilled" ? (() => {
          const ps = proposalRes.value.proposals ?? [];
          return { total: ps.length, open: ps.filter((p) => p.status === "submitted").length, accepted: ps.filter((p) => p.status === "accepted").length };
        })() : null,
        leads: leadRes.status === "fulfilled" ? (() => {
          const ls = leadRes.value.leads ?? [];
          const active = ls.filter((l) => !["won","lost"].includes(l.stage));
          return { total: ls.length, newCount: ls.filter((l) => l.stage === "new").length, pipelineValue: active.reduce((s, l) => s + (l.estimatedValue ?? 0), 0) };
        })() : null,
      });
    }
    load().catch(() => {});
  }, []);

  // Load reminder summary non-blocking when month changes
  useEffect(() => {
    fetchReminderSummary(month)
      .then(setReminderSummary)
      .catch(() => {}); // silently fail — reminder section is non-critical
  }, [month]);

  // The drawer renders below the ExpenseStrip/Reminder sections, so on a
  // shorter viewport a click can look like it did nothing unless we scroll it into view.
  useEffect(() => {
    if (activeFilter) {
      drawerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeFilter]);

  const handleSendReminders = async (type: ReminderType | "all") => {
    setSendingReminder(true);
    setReminderResult(null);
    try {
      const result = await sendReminders(month, type);
      setReminderResult(result);
      // Refresh summary after sending
      fetchReminderSummary(month).then(setReminderSummary).catch(() => {});
      notify(
        "success",
        language === "ja"
          ? `リマインダー送信完了: 送信 ${result.sent}件、失敗 ${result.failed}件、スキップ ${result.skipped}件`
          : `Reminders sent: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
        "/dashboard"
      );
    } catch (err) {
      notify("error", language === "ja" ? `リマインダー送信に失敗しました: ${String(err)}` : `Failed to send reminders: ${String(err)}`, "/dashboard");
    } finally {
      setSendingReminder(false);
    }
  };

  const handleSaveReadyFiles = async () => {
    setSaving(true);
    setSavedCount(null);
    setError(null);
    try {
      const { submissions } = await fetchInvoices(month);
      if (submissions.length === 0) {
        setError(
          language === "ja"
            ? "請求書データがありません。先に請求書一覧でCSVをアップロードしてください。"
            : "No invoices loaded. Please upload a CSV on the Invoices page first."
        );
        return;
      }
      const ids = submissions.map((s) => s.id);
      let validations = await fetchValidationResults(ids);

      // Auto-validate any submissions that haven't been validated yet
      const validatedIds = new Set(validations.map((v) => v.submissionId));
      const unvalidated = submissions.filter((s) => !validatedIds.has(s.id));
      if (unvalidated.length > 0) {
        const newResults = await validateInvoiceBatch(unvalidated, month, user ?? undefined);
        validations = [...validations, ...newResults];
      }

      const ready = validations.filter(
        (v) => v.statusCode === "READY" || v.humanApproved === true
      );
      if (ready.length === 0) {
        setError(
          language === "ja"
            ? "保存可能な請求書がありません。添付ファイルや金額をご確認ください。"
            : "No invoices are ready to save. Check that attachments and amounts are correct."
        );
        await loadStats();
        return;
      }
      const result = await fileInvoiceBulk(ready);
      setSavedCount(result.summary.filed);
      await loadStats();
      notify(
        "success",
        language === "ja" ? `${result.summary.filed}件のファイルを保存しました` : `Saved ${result.summary.filed} files`,
        "/dashboard"
      );
    } catch (err) {
      setError(String(err));
      notify("error", language === "ja" ? `保存に失敗しました: ${String(err)}` : `Failed to save files: ${String(err)}`, "/dashboard");
    } finally {
      setSaving(false);
    }
  };

  const handleRunValidation = async () => {
    setValidating(true);
    setError(null);
    try {
      const { submissions } = await fetchInvoices(month);
      if (submissions.length === 0) {
        setError(
          language === "ja"
            ? "請求書データがありません。先に請求書一覧でCSVをアップロードしてください。"
            : "No invoices loaded. Please upload a CSV on the Invoices page first."
        );
        return;
      }
      await validateInvoiceBatch(submissions, month, user ?? undefined);
      await Promise.all([loadStats(), loadInvoiceList()]);
      notify(
        "success",
        language === "ja" ? `${submissions.length}件の請求書を検証しました` : `Validated ${submissions.length} invoices`,
        "/dashboard"
      );
    } catch (err) {
      setError(String(err));
      notify("error", language === "ja" ? `検証に失敗しました: ${String(err)}` : `Validation failed: ${String(err)}`, "/dashboard");
    } finally {
      setValidating(false);
    }
  };

  const handleApprove = async (item: InvoiceListItem) => {
    setApprovingId(item.submission.id);
    try {
      const updated = await approveInvoice(item.submission.id, user ?? undefined);
      setInvoiceItems((prev) =>
        prev.map((i) =>
          i.submission.id === item.submission.id
            ? { ...i, validation: updated }
            : i
        )
      );
      await loadStats();
    } catch (err) {
      setError(String(err));
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          title={t("dashboard_title")}
          subtitle={t("dashboard_subtitle")}
          actions={<MonthSelector value={month} onChange={setMonth} availableMonths={availableMonths} />}
        />

        {/* ── Module summary cards ──────────────────────────────────── */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ModuleCard
            href="/invoices" label={t("nav_invoices")} icon={<InvoiceModIcon />}
            primary={stats?.totalRows ?? "—"}
            subs={[
              { label: t("ready"),          value: stats?.ready ?? 0,          color: (stats?.ready ?? 0) > 0 ? "green" : "neutral" },
              { label: t("review_required"), value: stats?.reviewRequired ?? 0, color: (stats?.reviewRequired ?? 0) > 0 ? "amber" : "neutral" },
            ]}
          />
          <ModuleCard
            href="/expenses" label={t("nav_expenses")} icon={<ExpenseModIcon />}
            primary={moduleData.expenses ? `¥${moduleData.expenses.pendingAmount.toLocaleString()}` : "—"}
            subs={[
              { label: t("dashboard_stat_pending"),    value: (moduleData.expenses?.submitted ?? 0) + (moduleData.expenses?.underReview ?? 0), color: (moduleData.expenses?.submitted ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("dashboard_stat_violations"), value: moduleData.expenses?.violations ?? 0, color: (moduleData.expenses?.violations ?? 0) > 0 ? "red" : "neutral" },
            ]}
          />
          <ModuleCard
            href="/clients" label={t("nav_clients")} icon={<ClientModIcon />}
            primary={moduleData.clients?.total ?? "—"}
            subs={[
              { label: t("dashboard_stat_active"),    value: moduleData.clients?.active ?? 0,    color: "green" },
              { label: t("dashboard_stat_prospects"), value: moduleData.clients?.prospects ?? 0, color: "neutral" },
            ]}
          />
          <ModuleCard
            href="/proposals" label={t("nav_proposals")} icon={<ProposalModIcon />}
            primary={moduleData.proposals?.total ?? "—"}
            subs={[
              { label: t("dashboard_stat_open"),     value: moduleData.proposals?.open ?? 0,     color: (moduleData.proposals?.open ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("dashboard_stat_accepted"), value: moduleData.proposals?.accepted ?? 0, color: "green" },
            ]}
          />
          <ModuleCard
            href="/leads" label={t("nav_leads")} icon={<LeadModIcon />}
            primary={moduleData.leads?.total ?? "—"}
            subs={[
              { label: t("dashboard_stat_new"),      value: moduleData.leads?.newCount ?? 0, color: (moduleData.leads?.newCount ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("dashboard_stat_pipeline"), value: moduleData.leads ? `¥${(moduleData.leads.pipelineValue / 1_000_000).toFixed(1)}M` : "—", color: "neutral" },
            ]}
          />
        </div>

        {/* ── Invoice processing section header ─────────────────────── */}
        <div className="flex items-center gap-2 mb-4">
          <InvoiceModIcon size={14} />
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{t("dashboard_invoice_processing")}</p>
          <span className="text-xs text-stone-300 ml-1">— {month}</span>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Button
            variant="primary"
            size="md"
            loading={loading}
            onClick={handleLoadInvoices}
            icon={<RefreshIcon />}
          >
            {t("load_invoices")}
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={validating}
            onClick={handleRunValidation}
            icon={<CheckIcon />}
          >
            {t("run_validation")}
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={saving}
            onClick={handleSaveReadyFiles}
            icon={<SaveIcon />}
          >
            {t("save_ready_files")}
          </Button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 flex items-center justify-between gap-4">
            <span className="font-mono">{error}</span>
            <Link href="/invoices" className="shrink-0">
              <Button variant="secondary" size="sm">
                {language === "ja" ? "請求書一覧へ →" : "Go to Invoices →"}
              </Button>
            </Link>
          </div>
        )}

        {/* Save success banner */}
        {savedCount !== null && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 text-sm text-emerald-700 flex items-center justify-between">
            <span>{t("dashboard_save_success").replace("{count}", String(savedCount))}</span>
            <button onClick={() => setSavedCount(null)} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* Stats grid */}
        {loading && !stats ? (
          <div className="flex items-center justify-center h-48 text-stone-400 text-sm">
            {t("loading")}
          </div>
        ) : stats ? (
          <>
            {/* Empty state — no invoices loaded yet */}
            {SHOW_DASHBOARD_NO_DATA_BANNER && stats.totalRows === 0 && !loading && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-6 py-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    {language === "ja" ? "請求書データがまだ読み込まれていません" : "No invoice data loaded yet"}
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {language === "ja"
                      ? "請求書一覧ページでCSVファイルをアップロードしてください。"
                      : "Go to the Invoices page and upload your CSV file to get started."}
                  </p>
                </div>
                <Link href="/invoices" className="shrink-0">
                  <Button variant="secondary" size="sm" icon={<UploadIcon />}>
                    {language === "ja" ? "CSVをアップロード" : "Upload CSV"}
                  </Button>
                </Link>
              </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={t("total_rows")} value={stats.totalRows} icon={<ListIcon />}
                active={activeFilter === "ALL"} onClick={() => handleCardClick("ALL")} />
              <StatCard label={t("ready")} value={stats.ready} accent="green" icon={<CheckCircleIcon />}
                active={activeFilter === "READY"} onClick={() => handleCardClick("READY")} />
              <StatCard label={t("review_required")} value={stats.reviewRequired} accent="amber" icon={<AlertIcon />}
                active={activeFilter === "REVIEW_REQUIRED"} onClick={() => handleCardClick("REVIEW_REQUIRED")} />
              <StatCard label={t("saved")} value={stats.saved} accent="blue" icon={<FolderIcon />}
                active={activeFilter === "SAVED"} onClick={() => handleCardClick("SAVED")} />
              <StatCard label={t("errors")} value={stats.errors} accent="red" icon={<XCircleIcon />}
                active={activeFilter === "ERRORS"} onClick={() => handleCardClick("ERRORS")} />
              <StatCard label={t("missing_attachment")} value={stats.missingAttachment} accent="red" icon={<AttachIcon />}
                active={activeFilter === "MISSING_ATTACHMENT"} onClick={() => handleCardClick("MISSING_ATTACHMENT")} />
              <StatCard label={t("already_processed")} value={stats.alreadyProcessed} accent="slate" icon={<ArchiveIcon />}
                active={activeFilter === "ALREADY_PROCESSED"} onClick={() => handleCardClick("ALREADY_PROCESSED")} />
            </div>

            {/* ── Expense claims strip ──────────────────────────────────────── */}
            {moduleData.expenses && <ExpenseStrip data={moduleData.expenses} language={language} />}

            {/* ── Phase 7: Reminder Status ──────────────────────────────────── */}
            <ReminderStatusSection
              summary={reminderSummary}
              sending={sendingReminder}
              result={reminderResult}
              onSend={handleSendReminders}
              language={language}
              t={t}
            />

            {/* Invoice drawer — shown when a card is active */}
            {activeFilter && (
              <div ref={drawerRef}>
              <InvoiceDrawer
                filter={activeFilter}
                items={invoiceItems}
                loading={invoicesLoading}
                t={t}
                onView={setSelectedItem}
                onApprove={handleApprove}
                approvingId={approvingId}
                onClose={() => setActiveFilter(null)}
              />
              </div>
            )}

            {lastUpdated && (
              <p className="text-xs text-stone-400">
                {t("last_updated")}: {formatTimestamp(lastUpdated, language)}
              </p>
            )}

            {stats.reviewRequired > 0 && (
              <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    {stats.reviewRequired}{" "}
                    {language === "ja"
                      ? "件の請求書が確認待ちです"
                      : `invoice${stats.reviewRequired > 1 ? "s" : ""} require review`}
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {language === "ja"
                      ? "請求書一覧で詳細を確認してください"
                      : "Check the invoice list for details"}
                  </p>
                </div>
                <Link href="/invoices">
                  <Button variant="secondary" size="sm">
                    {t("nav_invoices")} →
                  </Button>
                </Link>
              </div>
            )}
          </>
        ) : (
          !error && <div className="text-sm text-stone-400">{t("no_data")}</div>
        )}
      </div>

      {selectedItem && (
        <InvoiceDetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </AppShell>
  );
}

// ── Module summary card ───────────────────────────────────────────────────────

interface SubStat { label: string; value: string | number; color?: "green" | "amber" | "red" | "neutral" }

function ModuleCard({ href, label, icon, primary, subs }: {
  href: string; label: string; icon: React.ReactNode;
  primary: string | number; subs: SubStat[];
}) {
  const colorClass = (c?: SubStat["color"]) =>
    c === "green"   ? "text-emerald-600" :
    c === "amber"   ? "text-amber-600" :
    c === "red"     ? "text-red-500" :
    "text-stone-400";

  return (
    <Link href={href} className="group flex flex-col rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 hover:shadow-sm transition-all">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-bold tracking-widest uppercase text-stone-400">{label}</span>
        <span className="text-stone-300 group-hover:text-stone-400 transition-colors">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-stone-900 mb-2 font-mono tabular-nums">{primary}</p>
      <div className="flex gap-3 mt-auto">
        {subs.map((s) => (
          <span key={s.label} className="text-[10px]">
            <span className="text-stone-400">{s.label} </span>
            <span className={`font-semibold ${colorClass(s.color)}`}>{s.value}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

// ── Expense claims strip ──────────────────────────────────────────────────────

function ExpenseStrip({ data, language }: {
  data: { total: number; submitted: number; underReview: number; violations: number; pendingAmount: number };
  language: string;
}) {
  return (
    <div className="mb-6 rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <ExpenseModIcon size={14} />
          <p className="text-sm font-semibold text-stone-700">
            {language === "ja" ? "経費精算" : "Expense Claims"}
          </p>
        </div>
        <Link href="/expenses" className="text-xs text-[#1a3d2b] font-medium hover:underline">
          {language === "ja" ? "経費一覧 →" : "View all →"}
        </Link>
      </div>
      <div className="grid grid-cols-4 divide-x divide-stone-100 px-2 py-1">
        {[
          { label: language === "ja" ? "合計" : "Total",        value: data.total,       color: "text-stone-900" },
          { label: language === "ja" ? "申請中" : "Submitted",  value: data.submitted,   color: data.submitted   > 0 ? "text-amber-600"   : "text-stone-500" },
          { label: language === "ja" ? "審査中" : "Under Review",value: data.underReview, color: data.underReview > 0 ? "text-blue-600"    : "text-stone-500" },
          { label: language === "ja" ? "違反" : "Violations",   value: data.violations,  color: data.violations  > 0 ? "text-red-600"     : "text-stone-500" },
        ].map((cell) => (
          <div key={cell.label} className="flex flex-col items-center py-3 px-4">
            <span className={`text-xl font-bold tabular-nums ${cell.color}`}>{cell.value}</span>
            <span className="text-[10px] text-stone-400 mt-0.5">{cell.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Module icons ──────────────────────────────────────────────────────────────

function InvoiceModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
function ExpenseModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}
function ClientModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ProposalModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function LeadModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.16 12 19.79 19.79 0 0 1 1.05 3.42 2 2 0 0 1 3 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z" />
    </svg>
  );
}

// ── Reminder status section (Phase 7) ────────────────────────────────────────

function ReminderStatusSection({
  summary,
  sending,
  result,
  onSend,
  language,
  t,
}: {
  summary: ReminderSummary | null;
  sending: boolean;
  result: { sent: number; failed: number; skipped: number } | null;
  onSend: (type: ReminderType | "all") => void;
  language: string;
  t: (k: Parameters<ReturnType<typeof useLanguage>["t"]>[0]) => string;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const chips = summary
    ? [
        {
          label: t("reminder_missing_invoice"),
          value: `${summary.missingInvoice.count}/${summary.missingInvoice.total}`,
          color: summary.missingInvoice.count > 0 ? "amber" : "green",
          type: "missing_invoice" as ReminderType,
          href: summary.missingInvoice.count > 0 ? "/invoices" : undefined,
        },
        {
          label: t("reminder_stale_review"),
          value: summary.staleReview.count > 0 ? `${summary.staleReview.count} (${summary.staleReview.oldestDays}d)` : "0",
          color: summary.staleReview.count > 0 ? "amber" : "green",
          type: "stale_review" as ReminderType,
          href: summary.staleReview.count > 0 ? "/invoices" : undefined,
        },
        {
          label: t("reminder_due_approaching"),
          value: String(summary.dueDateApproaching.count),
          color: summary.dueDateApproaching.count > 0 ? "amber" : "green",
          type: "due_date_approaching" as ReminderType,
          href: summary.dueDateApproaching.count > 0 ? "/invoices" : undefined,
        },
        {
          label: t("reminder_due_overdue"),
          value: String(summary.dueDateOverdue.count),
          color: summary.dueDateOverdue.count > 0 ? "red" : "green",
          type: "due_date_overdue" as ReminderType,
          href: summary.dueDateOverdue.count > 0 ? "/invoices" : undefined,
        },
      ]
    : [];

  return (
    <div className="mb-6 bg-white rounded-xl border border-stone-200 overflow-visible">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <BellIcon />
          <p className="text-sm font-semibold text-stone-700">{t("reminder_section_title")}</p>
        </div>
        <div className="flex items-center gap-3">
          {summary?.lastSent && (
            <span className="text-xs text-stone-400">
              {t("reminder_last_sent")}: {new Date(summary.lastSent).toLocaleDateString(language === "ja" ? "ja-JP" : "en-US")}
            </span>
          )}
          <div className="relative">
            <button
              onClick={() => setTypeOpen((p) => !p)}
              disabled={sending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a3d2b] text-white text-xs font-medium hover:bg-[#1a3d2b]/90 disabled:opacity-50 transition"
            >
              {sending ? t("reminder_sending") : t("reminder_send_all")}
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="opacity-60 mt-px">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {typeOpen && !sending && (
              <>
                {/* backdrop to close on outside click */}
                <div className="fixed inset-0 z-20" onClick={() => setTypeOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-[200px]">
                  {([
                    ["all",                   t("reminder_send_type_all")],
                    ["missing_invoice",       t("reminder_send_type_missing")],
                    ["stale_review",          t("reminder_send_type_stale")],
                    ["due_date_approaching",  t("reminder_send_type_due")],
                  ] as [ReminderType | "all", string][]).map(([type, label]) => (
                    <button
                      key={type}
                      onClick={() => { setTypeOpen(false); onSend(type); }}
                      className="w-full text-left px-4 py-2 text-xs text-stone-700 hover:bg-stone-50 transition"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {!summary ? (
          <p className="text-xs text-stone-400">{t("reminder_loading")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {chips.map((chip) => {
                const cardClass = `rounded-lg px-3 py-2.5 border transition-all ${
                  chip.color === "red"   ? "bg-red-50 border-red-200"   + (chip.href ? " hover:bg-red-100 hover:border-red-300 cursor-pointer" : "") :
                  chip.color === "amber" ? "bg-amber-50 border-amber-200" + (chip.href ? " hover:bg-amber-100 hover:border-amber-300 cursor-pointer" : "") :
                  "bg-emerald-50 border-emerald-200"
                }`;
                const inner = (
                  <>
                    <p className={`text-xs font-medium mb-0.5 ${
                      chip.color === "red"   ? "text-red-700" :
                      chip.color === "amber" ? "text-amber-700" :
                      "text-emerald-700"
                    }`}>{chip.label}</p>
                    <p className={`text-lg font-bold ${
                      chip.color === "red"   ? "text-red-900" :
                      chip.color === "amber" ? "text-amber-900" :
                      "text-emerald-900"
                    }`}>{chip.value}{chip.href && <span className="text-xs font-normal ml-1 opacity-60">→</span>}</p>
                  </>
                );
                return chip.href ? (
                  <a key={chip.type} href={chip.href} className={cardClass}>{inner}</a>
                ) : (
                  <div key={chip.type} className={cardClass}>{inner}</div>
                );
              })}
            </div>

            {result && (
              <p className="text-xs text-emerald-600 mb-2">
                ✓ {t("reminder_result")
                  .replace("{sent}", String(result.sent))
                  .replace("{failed}", String(result.failed))
                  .replace("{skipped}", String(result.skipped))}
              </p>
            )}

            {summary.recentLogs.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHistory((p) => !p)}
                  className="text-xs text-stone-400 hover:text-stone-600 transition"
                >
                  {t("reminder_history")} {showHistory ? "▲" : "▼"}
                </button>
                {showHistory && (
                  <div className="mt-2 space-y-1">
                    {summary.recentLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="flex items-center gap-2 text-xs text-stone-500">
                        <span className={log.status === "sent" ? "text-emerald-500" : log.status === "failed" ? "text-red-500" : "text-stone-300"}>
                          {log.status === "sent" ? "✓" : log.status === "failed" ? "✗" : "–"}
                        </span>
                        <span className="font-mono text-stone-400">{new Date(log.sentAt).toLocaleDateString()}</span>
                        <span>{t(REMINDER_TYPE_KEY[log.reminderType] ?? "unknown")}</span>
                        <span className="text-stone-300">{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ── Invoice drawer ─────────────────────────────────────────────────────────────

const ERROR_FILTER_CODES = new Set([
  "PDF_LINK_ERROR", "DATE_MISSING", "TAX_MISSING",
  "AMOUNT_MISMATCH", "PROJECT_INFO_MISSING", "SAVE_ERROR",
]);

const FILTER_LABEL_KEY: Record<string, TranslationKey> = {
  READY: "status_READY",
  REVIEW_REQUIRED: "status_REVIEW_REQUIRED",
  SAVED: "saved",
  MISSING_ATTACHMENT: "status_MISSING_ATTACHMENT",
  ERRORS: "errors",
  ALREADY_PROCESSED: "status_ALREADY_PROCESSED",
};

function filterItems(items: InvoiceListItem[], filter: string): InvoiceListItem[] {
  if (filter === "ALL") return items;
  if (filter === "READY") return items.filter((i) => i.validation?.statusCode === "READY");
  if (filter === "REVIEW_REQUIRED") return items.filter((i) => i.validation?.statusCode === "REVIEW_REQUIRED");
  if (filter === "SAVED") return items.filter((i) => i.filedDocument != null);
  if (filter === "MISSING_ATTACHMENT") return items.filter((i) =>
    i.validation?.statusCode === "MISSING_ATTACHMENT" || (!i.validation && !i.submission.invoiceAttachment)
  );
  if (filter === "ERRORS") return items.filter((i) =>
    i.validation && ERROR_FILTER_CODES.has(i.validation.statusCode)
  );
  if (filter === "ALREADY_PROCESSED") return items.filter((i) =>
    ["ALREADY_PROCESSED", "DUPLICATE_FILE"].includes(i.validation?.statusCode ?? "")
  );
  return items;
}

function InvoiceDrawer({
  filter, items, loading, t, onView, onApprove, approvingId, onClose,
}: {
  filter: string;
  items: InvoiceListItem[];
  loading: boolean;
  t: (k: Parameters<ReturnType<typeof useLanguage>["t"]>[0]) => string;
  onView: (item: InvoiceListItem) => void;
  onApprove: (item: InvoiceListItem) => void;
  approvingId: string | null;
  onClose: () => void;
}) {
  const filtered = filterItems(items, filter);

  return (
    <div className="mt-2 mb-6 bg-white rounded-xl border border-stone-200 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50">
        <p className="text-sm font-semibold text-stone-700">
          {filter === "ALL" ? t("dashboard_all_invoices") : t(FILTER_LABEL_KEY[filter] ?? "unknown")}
          <span className="ml-2 text-xs font-normal text-stone-400">({filtered.length})</span>
        </p>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24 text-stone-400 text-sm">
          {t("loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-stone-400 text-sm">
          {t("dashboard_no_invoices_match")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_name")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_which_month")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_invoice_category")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_invoice_amount")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_attachment")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("col_status")}</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {filtered.map((item) => {
                const s = item.submission;
                return (
                  <tr key={s.id} className="hover:bg-stone-50/70 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-stone-900 whitespace-nowrap">
                      <span className="text-xs text-stone-400 font-mono mr-1.5">#{s.submissionRowNumber}</span>
                      {s.payerName}
                    </td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{s.closingMonth || t("none")}</td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{s.projectType || t("none")}</td>
                    <td className="px-4 py-2.5 text-stone-700 font-mono text-xs whitespace-nowrap">{formatCurrency(s.claimedAmountTaxIncluded, s.currency)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {s.invoiceAttachment
                        ? <span className="text-stone-500 font-mono truncate block max-w-[140px]" title={s.invoiceAttachment}>📎 {s.invoiceAttachment}</span>
                        : <span className="text-red-400">✗ {t("no_file")}</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {item.validation
                        ? <StatusBadge code={item.validation.statusCode} size="sm" />
                        : <span className="text-xs text-stone-300">{t("none")}</span>
                      }
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => onView(item)}>
                          {t("action_view")}
                        </Button>
                        {item.validation?.statusCode === "REVIEW_REQUIRED" && (
                          <Button
                            variant="primary"
                            size="sm"
                            loading={approvingId === item.submission.id}
                            onClick={() => onApprove(item)}
                          >
                            {t("action_approve")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function SaveIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function XCircleIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
function AttachIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
