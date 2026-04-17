"use client";
// src/app/dashboard/page.tsx

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import MonthSelector from "@/components/ui/MonthSelector";
import { useLanguage } from "@/translations";
import {
  fetchDashboardStats,
  validateInvoiceBatch,
  fetchInvoices,
  fileInvoice,
  fetchValidationResults,
} from "@/lib/api/client";
import { monthOptions, formatTimestamp } from "@/lib/utils";
import type { DashboardStats } from "@/types";

export default function DashboardPage() {
  const { t, language } = useLanguage();
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSaveReadyFiles = async () => {
    setSaving(true);
    setSavedCount(null);
    setError(null);
    try {
      const submissions = await fetchInvoices(month);
      const ids = submissions.map((s) => s.id);
      const validations = await fetchValidationResults(ids);
      const ready = validations.filter((v) => v.statusCode === "READY");
      await Promise.all(ready.map((v) => fileInvoice(v)));
      setSavedCount(ready.length);
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
      await validateInvoiceBatch(submissions);
      await loadStats();
    } catch (err) {
      setError(String(err));
    } finally {
      setValidating(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          title={t("dashboard_title")}
          subtitle={t("dashboard_subtitle")}
          actions={<MonthSelector value={month} onChange={setMonth} />}
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
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 font-mono">
            {error}
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
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t("total_rows")}
                value={stats.totalRows}
                icon={<ListIcon />}
              />
              <StatCard
                label={t("ready")}
                value={stats.ready}
                accent="green"
                icon={<CheckCircleIcon />}
              />
              <StatCard
                label={t("review_required")}
                value={stats.reviewRequired}
                accent="amber"
                icon={<AlertIcon />}
              />
              <StatCard
                label={t("saved")}
                value={stats.saved}
                accent="blue"
                icon={<FolderIcon />}
              />
              <StatCard
                label={t("errors")}
                value={stats.errors}
                accent="red"
                icon={<XCircleIcon />}
              />
              <StatCard
                label={t("missing_attachment")}
                value={stats.missingAttachment}
                accent="red"
                icon={<AttachIcon />}
              />
              <StatCard
                label={t("already_processed")}
                value={stats.alreadyProcessed}
                accent="slate"
                icon={<ArchiveIcon />}
              />
            </div>

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
    </AppShell>
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
