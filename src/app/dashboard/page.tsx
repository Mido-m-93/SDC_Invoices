"use client";
// src/app/dashboard/page.tsx

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import MonthSelector from "@/components/ui/MonthSelector";
import StatusBadge from "@/components/ui/StatusBadge";
import InvoiceDetailPanel from "@/components/invoice/InvoiceDetailPanel";
import { useLanguage } from "@/translations";
import {
  fetchDashboardStats,
  validateInvoiceBatch,
  fetchInvoices,
  fileInvoiceBulk,
  fetchValidationResults,
  fetchFiledDocuments,
  fetchAvailableMonths,
  approveInvoice,
} from "@/lib/api/client";
import { monthOptions, formatTimestamp, formatCurrency } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import type { DashboardStats, InvoiceListItem } from "@/types";
import clsx from "clsx";

export default function DashboardPage() {
  const { t, language } = useLanguage();
  const { user } = useCurrentUser();
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
      const submissions = await fetchInvoices(month);
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
    } catch {
      // silently fail — stats are still shown
    } finally {
      setInvoicesLoading(false);
    }
  }, [month]);

  const handleCardClick = (filter: string) => {
    if (activeFilter === filter) {
      setActiveFilter(null);
      return;
    }
    setActiveFilter(filter);
    if (invoiceItems.length === 0) loadInvoiceList();
  };

  // On mount: fetch available months and auto-select the most recent one with data
  useEffect(() => {
    fetchAvailableMonths().then((months) => {
      setAvailableMonths(months);
      if (months.length > 0 && !months.includes(monthOptions(1)[0])) {
        setMonth(months[0]);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSaveReadyFiles = async () => {
    setSaving(true);
    setSavedCount(null);
    setError(null);
    try {
      const submissions = await fetchInvoices(month);
      if (submissions.length === 0) {
        setError(
          language === "ja"
            ? "請求書データがありません。先に請求書一覧でCSVをアップロードしてください。"
            : "No invoices loaded. Please upload a CSV on the Invoices page first."
        );
        return;
      }
      const ids = submissions.map((s) => s.id);
      const validations = await fetchValidationResults(ids);
      const ready = validations.filter((v) => v.statusCode === "READY");
      if (ready.length === 0) {
        setError(
          language === "ja"
            ? "保存可能な請求書がありません。先にバリデーションを実行してください。"
            : "No READY invoices to save. Run validation first."
        );
        return;
      }
      const result = await fileInvoiceBulk(ready);
      setSavedCount(result.summary.filed);
      await loadStats();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRunValidation = async () => {
    setValidating(true);
    setError(null);
    try {
      const submissions = await fetchInvoices(month);
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
    } catch (err) {
      setError(String(err));
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

        {/* Action bar */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Button
            variant="primary"
            size="md"
            loading={loading}
            onClick={loadStats}
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
            <span>✓ {savedCount} file{savedCount !== 1 ? "s" : ""} saved successfully</span>
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
            {stats.totalRows === 0 && !loading && (
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

            {/* Invoice drawer — shown when a card is active */}
            {activeFilter && (
              <InvoiceDrawer
                filter={activeFilter}
                items={invoiceItems}
                loading={invoicesLoading}
                language={language}
                t={t}
                onView={setSelectedItem}
                onApprove={handleApprove}
                approvingId={approvingId}
                onClose={() => setActiveFilter(null)}
              />
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

// ── Invoice drawer ─────────────────────────────────────────────────────────────

const ERROR_FILTER_CODES = new Set([
  "PDF_LINK_ERROR", "DATE_MISSING", "TAX_MISSING",
  "AMOUNT_MISMATCH", "PROJECT_INFO_MISSING", "SAVE_ERROR",
]);

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
  filter, items, loading, language, t, onView, onApprove, approvingId, onClose,
}: {
  filter: string;
  items: InvoiceListItem[];
  loading: boolean;
  language: string;
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
          {filter === "ALL" ? (language === "ja" ? "すべての請求書" : "All Invoices") : filter.replace(/_/g, " ")}
          <span className="ml-2 text-xs font-normal text-stone-400">({filtered.length})</span>
        </p>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24 text-stone-400 text-sm">
          {language === "ja" ? "読み込み中..." : "Loading..."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-stone-400 text-sm">
          {language === "ja" ? "該当する請求書がありません" : "No invoices match this filter"}
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
                    <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{s.closingMonth || "—"}</td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{s.projectType || "—"}</td>
                    <td className="px-4 py-2.5 text-stone-700 font-mono text-xs whitespace-nowrap">{formatCurrency(s.claimedAmountTaxIncluded)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {s.invoiceAttachment
                        ? <span className="text-stone-500 font-mono truncate block max-w-[140px]" title={s.invoiceAttachment}>📎 {s.invoiceAttachment}</span>
                        : <span className="text-red-400">✗ {language === "ja" ? "なし" : "None"}</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {item.validation
                        ? <StatusBadge code={item.validation.statusCode} size="sm" />
                        : <span className="text-xs text-stone-300">—</span>
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
