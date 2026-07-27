"use client";
// src/app/logs/page.tsx

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import { fetchRuns, fetchLogs } from "@/lib/api/client";
import { formatTimestamp, logResultColor } from "@/lib/utils";
import type { ProcessingRun, ProcessingLog } from "@/types";
import clsx from "clsx";

export default function LogsPage() {
  const { t, language } = useLanguage();
  const [runs, setRuns] = useState<ProcessingRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRuns();
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally omit selectedRunId — only set it on first load

  const loadLogs = useCallback(async (runId: string) => {
    setLogsLoading(true);
    setError(null);
    try {
      const data = await fetchLogs(runId);
      setLogs(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { if (selectedRunId) loadLogs(selectedRunId); }, [selectedRunId, loadLogs]);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <AppShell>
      <div className="px-8 py-8">
        <PageHeader
          title={t("logs_title")}
          actions={
            <Button variant="secondary" size="md" onClick={loadRuns} loading={loading} icon={<RefreshIcon />}>
              {t("load_invoices")}
            </Button>
          }
        />

        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 font-mono">
            {error}
          </div>
        )}

        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-stone-400 text-sm">{t("loading")}</div>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-stone-400 text-sm">{t("logs_no_runs")}</div>
        ) : (
          <div className="flex gap-6">
            {/* Run list sidebar */}
            <div className="w-72 flex-shrink-0">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
                {t("logs_run_history")}
              </h3>
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={clsx(
                      "w-full text-left p-4 rounded-xl border transition-all",
                      selectedRunId === run.id
                        ? "border-[#2d6a4f] bg-emerald-50"
                        : "border-stone-200 bg-white hover:border-stone-300"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-stone-400 truncate">{run.id}</span>
                      <RunStatusPill status={run.status} />
                    </div>
                    <p className="text-sm font-medium text-stone-800 mb-1">{run.month}</p>
                    <p className="text-xs text-stone-400">{formatTimestamp(run.startedAt, language)}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      <span className="text-emerald-600">✓ {run.saved}</span>
                      <span className="text-amber-600">⚠ {run.reviewRequired}</span>
                      <span className="text-red-600">✗ {run.errors}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Log detail */}
            <div className="flex-1 min-w-0">
              {selectedRun && (
                <div className="mb-4 bg-white rounded-xl border border-stone-200 p-4 grid grid-cols-4 gap-4">
                  <RunMeta label={t("logs_run_id")} value={selectedRun.id} mono />
                  <RunMeta label={t("logs_started_at")} value={formatTimestamp(selectedRun.startedAt, language)} />
                  <RunMeta
                    label={t("logs_completed_at")}
                    value={selectedRun.completedAt ? formatTimestamp(selectedRun.completedAt, language) : "—"}
                  />
                  <RunMeta label={t("total_rows")} value={String(selectedRun.totalRows)} />
                </div>
              )}

              {logsLoading ? (
                <div className="flex items-center justify-center h-32 text-stone-400 text-sm">{t("loading")}</div>
              ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 bg-stone-50">
                        <Th>{t("logs_col_time")}</Th>
                        <Th>{t("logs_step")}</Th>
                        <Th>{t("logs_col_submission")}</Th>
                        <Th>{t("logs_result")}</Th>
                        <Th>{t("logs_message")}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50 font-mono text-xs">
                      {logs.map((log) => (
                        <tr key={log.id} className="hover:bg-stone-50">
                          <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">
                            {formatTimestamp(log.timestamp, language)}
                          </td>
                          <td className="px-4 py-2.5 text-stone-600 whitespace-nowrap">{log.step}</td>
                          <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">{log.submissionId}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={clsx("font-semibold", logResultColor(log.result))}>
                              {log.result}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-stone-600 max-w-xs">{log.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2.5 border-t border-stone-100 bg-stone-50">
                    <p className="text-xs text-stone-400">
                      {logs.length} {t("logs_entries")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RunMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={clsx("text-xs text-stone-700 truncate", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function RunStatusPill({ status }: { status: ProcessingRun["status"] }) {
  const colors: Record<ProcessingRun["status"], string> = {
    RUNNING:  "bg-blue-50 text-blue-600",
    COMPLETE: "bg-emerald-50 text-emerald-600",
    FAILED:   "bg-red-50 text-red-600",
  };
  return (
    <span className={clsx("text-[10px] font-medium px-1.5 py-0.5 rounded font-mono", colors[status])}>
      {status}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function RefreshIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
}
