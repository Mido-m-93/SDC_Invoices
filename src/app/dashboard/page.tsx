"use client";
// src/app/dashboard/page.tsx

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import MonthSelector from "@/components/ui/MonthSelector";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import {
  fetchDashboardStats,
  fetchAvailableMonths,
  fetchReminderSummary,
  sendReminders,
} from "@/lib/api/client";
import { monthOptions, formatTimestamp } from "@/lib/utils";
import type { DashboardStats, ReminderSummary, ReminderType, ExpenseClaim, Proposal, Contract, Budget, StagedPipelineRecord, Language } from "@/types";
import type { TranslationKey } from "@/translations";
import { computeContractStats } from "@/lib/contractStats";
import clsx from "clsx";

interface ActivityItem {
  id: string;
  type: "proposal" | "budget" | "contract" | "expense";
  title: string;
  timestamp: string;
  href: string;
}

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
  const { notify } = useNotifications();
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [monthResolved, setMonthResolved] = useState(false);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminderSummary, setReminderSummary] = useState<ReminderSummary | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [moduleData, setModuleData] = useState<{
    expenses: { total: number; submitted: number; underReview: number; violations: number; pendingAmount: number } | null;
    proposals: { total: number; open: number; accepted: number; pipelineTotal: number; pipelinePending: number } | null;
    contracts: { total: number; active: number; expiringSoon: number } | null;
    budget: { total: number; draft: number; confirmed: number; sharepointFiles: number } | null;
  }>({ expenses: null, proposals: null, contracts: null, budget: null });
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  const loadStats = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchDashboardStats(month);
      setStats(data);
    } catch (err) {
      setError(String(err));
    }
  }, [month]);

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
    }).catch(() => {}).finally(() => setMonthResolved(true));
  }, []);

  // Wait until the actual data month is resolved before fetching stats, so
  // the Invoices card doesn't flash the current (likely empty) month's
  // count before settling on the real one.
  useEffect(() => {
    if (!monthResolved) return;
    loadStats();
  }, [loadStats, monthResolved]);

  // Load cross-module summary counts (non-blocking, best-effort)
  useEffect(() => {
    async function load() {
      const [expRes, proposalRes, contractRes, budgetRes, pipelineRes, budgetSharePointRes] = await Promise.allSettled([
        fetch("/api/expenses").then((r) => r.json() as Promise<{ claims: ExpenseClaim[] }>),
        fetch("/api/proposals").then((r) => r.json() as Promise<{ proposals: Proposal[] }>),
        fetch("/api/contracts").then((r) => r.json() as Promise<{ contracts: Contract[] }>),
        fetch("/api/budgets").then((r) => r.json() as Promise<{ budgets: Budget[] }>),
        fetch("/api/pipeline-sync").then((r) => r.json() as Promise<{ records: StagedPipelineRecord[] }>),
        fetch("/api/budgets/sync", { method: "POST" }).then((r) => r.json() as Promise<{ files?: unknown[] }>),
      ]);
      const pipelineRecords = pipelineRes.status === "fulfilled" ? (pipelineRes.value.records ?? []) : [];
      const pipelineTotal = pipelineRecords.length;
      const pipelinePending = pipelineRecords.filter((r) => r.status === "needs_review" || r.status === "auto_linked").length;
      const budgetSharePointFiles = budgetSharePointRes.status === "fulfilled" ? (budgetSharePointRes.value.files?.length ?? 0) : 0;

      const proposalsArr = proposalRes.status === "fulfilled" ? (proposalRes.value.proposals ?? []) : [];
      const budgetsArr   = budgetRes.status   === "fulfilled" ? (budgetRes.value.budgets ?? [])     : [];
      const contractsArr = contractRes.status === "fulfilled" ? (contractRes.value.contracts ?? []) : [];
      const expensesArr  = expRes.status      === "fulfilled" ? (expRes.value.claims ?? [])         : [];

      const activity: ActivityItem[] = [
        ...proposalsArr.map((p) => ({
          id: `proposal-${p.id}`, type: "proposal" as const,
          title: p.projectName || p.clientName || "Proposal",
          timestamp: p.createdAt, href: "/proposals",
        })),
        ...budgetsArr.map((b) => ({
          id: `budget-${b.id}`, type: "budget" as const,
          title: b.projectName || "Budget",
          timestamp: b.createdAt, href: "/budget",
        })),
        ...contractsArr.map((c) => ({
          id: `contract-${c.id}`, type: "contract" as const,
          title: c.clientName || c.vendorId || "Contract",
          timestamp: c.createdAt, href: "/contracts",
        })),
        ...expensesArr.map((e) => ({
          id: `expense-${e.id}`, type: "expense" as const,
          title: e.description || e.extractedVendor || "Expense",
          timestamp: e.submittedAt, href: "/expenses",
        })),
      ]
        .filter((a) => !!a.timestamp)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 8);
      setRecentActivity(activity);

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
        proposals: proposalRes.status === "fulfilled" ? (() => {
          const ps = proposalRes.value.proposals ?? [];
          return {
            total:    ps.length,
            open:     ps.filter((p) => p.status === "submitted").length,
            accepted: ps.filter((p) => p.status === "accepted").length,
            pipelineTotal,
            pipelinePending,
          };
        })() : null,
        contracts: contractRes.status === "fulfilled"
          ? computeContractStats(contractRes.value.contracts ?? [], new Date())
          : null,
        budget: budgetRes.status === "fulfilled" ? (() => {
          const bs = budgetRes.value.budgets ?? [];
          return {
            total:           bs.length,
            draft:           bs.filter((b) => b.status === "draft").length,
            confirmed:       bs.filter((b) => b.status === "confirmed").length,
            sharepointFiles: budgetSharePointFiles,
          };
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

  const contractsExpiringSoon = moduleData.contracts?.expiringSoon ?? 0;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          title={t("dashboard_title")}
          subtitle={t("dashboard_subtitle")}
          actions={<MonthSelector value={month} onChange={setMonth} availableMonths={availableMonths} />}
        />

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Module overview grid ──────────────────────────────────── */}
        {/* Leads not tracked on this dashboard. */}
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <ModuleCard
            href="/invoices" label={t("nav_invoices")} icon={<InvoiceModIcon />}
            primary={stats?.totalRows ?? "—"}
            subs={[
              { label: t("ready"),           value: stats?.ready ?? 0,           color: "green" },
              { label: t("review_required"), value: stats?.reviewRequired ?? 0,  color: (stats?.reviewRequired ?? 0) > 0 ? "amber" : "neutral" },
            ]}
          />
          <ModuleCard
            href="/expenses" label={t("nav_expenses")} icon={<ExpenseModIcon />}
            primary={moduleData.expenses?.total ?? "—"}
            subs={[
              { label: t("dashboard_stat_submitted"),  value: moduleData.expenses?.submitted ?? 0,  color: (moduleData.expenses?.submitted ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("dashboard_stat_violations"), value: moduleData.expenses?.violations ?? 0, color: (moduleData.expenses?.violations ?? 0) > 0 ? "red" : "neutral" },
            ]}
          />
          <ModuleCard
            href="/contracts" label={t("nav_contracts")} icon={<ContractModIcon />}
            primary={moduleData.contracts?.total ?? "—"}
            subs={[
              { label: t("dashboard_stat_active"),         value: moduleData.contracts?.active ?? 0,       color: "green" },
              { label: t("dashboard_stat_expiring_soon"),  value: contractsExpiringSoon, color: contractsExpiringSoon > 0 ? "amber" : "neutral" },
            ]}
          />
          <ModuleCard
            href="/proposals" label={t("dashboard_sales_label")} icon={<ProposalModIcon />}
            primary={moduleData.proposals ? moduleData.proposals.total + moduleData.proposals.pipelineTotal : "—"}
            subs={[
              { label: t("dashboard_stat_pipeline_pending"), value: moduleData.proposals?.pipelinePending ?? 0, color: (moduleData.proposals?.pipelinePending ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("dashboard_stat_accepted"),         value: moduleData.proposals?.accepted ?? 0,        color: "green" },
            ]}
          />
          <ModuleCard
            href="/budget" label={t("nav_budget")} icon={<BudgetModIcon />}
            primary={moduleData.budget ? moduleData.budget.total + moduleData.budget.sharepointFiles : "—"}
            subs={[
              { label: t("dashboard_stat_sharepoint_files"), value: moduleData.budget?.sharepointFiles ?? 0, color: (moduleData.budget?.sharepointFiles ?? 0) > 0 ? "amber" : "neutral" },
              { label: t("budget_status_confirmed"),         value: moduleData.budget?.confirmed ?? 0,       color: "green" },
            ]}
          />
        </div>

        {/* ── Phase 7: Reminder Status ──────────────────────────────────── */}
        <ReminderStatusSection
          summary={reminderSummary}
          sending={sendingReminder}
          result={reminderResult}
          onSend={handleSendReminders}
          language={language}
          t={t}
        />

        {/* ── Recent activity ──────────────────────────────────────────── */}
        <RecentActivitySection items={recentActivity} language={language} t={t} />
      </div>
    </AppShell>
  );
}

// ── Module summary card ───────────────────────────────────────────────────────

interface SubStat { label: string; value: string | number; color?: "green" | "amber" | "red" | "neutral" }

function ModuleCard({ href, label, icon, primary, subs }: {
  href: string;
  label: string; icon: React.ReactNode;
  primary: string | number; subs: SubStat[];
}) {
  const colorClass = (c?: SubStat["color"]) =>
    c === "green"   ? "text-emerald-600" :
    c === "amber"   ? "text-amber-600" :
    c === "red"     ? "text-red-500" :
    "text-stone-400";

  const className = clsx(
    "group flex flex-col rounded-xl border bg-white p-4 hover:shadow-sm transition-all text-left w-full",
    "border-stone-200 hover:border-stone-300"
  );

  return (
    <Link href={href} className={className}>
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
function ProposalModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function ContractModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
function BudgetModIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
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
          href: "/invoices",
        },
        {
          label: t("reminder_stale_review"),
          value: summary.staleReview.count > 0 ? `${summary.staleReview.count} (${summary.staleReview.oldestDays}d)` : "0",
          color: summary.staleReview.count > 0 ? "amber" : "green",
          type: "stale_review" as ReminderType,
          href: "/invoices",
        },
        {
          label: t("reminder_due_approaching"),
          value: String(summary.dueDateApproaching.count),
          color: summary.dueDateApproaching.count > 0 ? "amber" : "green",
          type: "due_date_approaching" as ReminderType,
          href: "/invoices",
        },
        {
          label: t("reminder_due_overdue"),
          value: String(summary.dueDateOverdue.count),
          color: summary.dueDateOverdue.count > 0 ? "red" : "green",
          type: "due_date_overdue" as ReminderType,
          href: "/invoices",
        },
        {
          label: language === "ja" ? "未処理経費" : "Pending Expenses",
          value: String(summary.pendingExpenses.count),
          color: summary.pendingExpenses.count > 0 ? "amber" : "green",
          type: "missing_invoice" as ReminderType,
          href: "/expenses",
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
              {chips.map((chip) => {
                const cardClass = `rounded-lg px-3 py-2.5 border transition-all cursor-pointer ${
                  chip.color === "red"   ? "bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300" :
                  chip.color === "amber" ? "bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-300" :
                  "bg-emerald-50 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300"
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

// ── Recent activity ────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ReactNode> = {
  proposal: <ProposalModIcon size={14} />,
  budget:   <BudgetModIcon size={14} />,
  contract: <ContractModIcon size={14} />,
  expense:  <ExpenseModIcon size={14} />,
};

function RecentActivitySection({ items, language, t }: {
  items: ActivityItem[];
  language: Language;
  t: (k: Parameters<ReturnType<typeof useLanguage>["t"]>[0]) => string;
}) {
  const ACTIVITY_LABEL: Record<ActivityItem["type"], string> = {
    proposal: t("dashboard_sales_label"),
    budget:   t("nav_budget"),
    contract: t("nav_contracts"),
    expense:  t("nav_expenses"),
  };

  return (
    <div className="mb-6 bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-stone-100 bg-stone-50 rounded-t-xl">
        <ClockIcon />
        <p className="text-sm font-semibold text-stone-700">{t("dashboard_recent_activity_title")}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-stone-400">{t("dashboard_recent_activity_empty")}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-center gap-3 px-5 py-3 hover:bg-stone-50 transition">
                <span className="text-stone-400 shrink-0">{ACTIVITY_ICON[item.type]}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-stone-800">{item.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-stone-400">{ACTIVITY_LABEL[item.type]}</span>
                <span className="shrink-0 text-xs text-stone-400 font-mono">{formatTimestamp(item.timestamp, language)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
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
