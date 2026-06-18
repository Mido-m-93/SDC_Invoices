"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { InvoiceListItem } from "@/types";

type FilterLevel = "ALL" | "BLOCKED" | "NEEDS_REVIEW";

export default function ExceptionsPage() {
  const [items, setItems]           = useState<InvoiceListItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [filter, setFilter]         = useState<FilterLevel>("ALL");
  const [months, setMonths]         = useState<string[]>([]);
  const [selectedMonth, setMonth]   = useState("");
  const [error, setError]           = useState<string | null>(null);

  const loadMonths = useCallback(async () => {
    try {
      const res  = await fetch("/api/invoices/months");
      const data = await res.json() as { months: string[] };
      const list = data.months ?? [];
      setMonths(list);
      if (list.length > 0) setMonth(list[0]);
    } catch {
      setError("Failed to load months");
    }
  }, []);

  const loadExceptions = useCallback(async (month: string) => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/invoices?month=${month}`);
      const data = await res.json() as { items: InvoiceListItem[] };
      const all  = data.items ?? [];
      // Filter to only items with risk issues
      const exceptions = all.filter((item) => {
        const risk = item.validation?.riskLevel;
        return risk === "BLOCKED" || risk === "NEEDS_REVIEW";
      });
      setItems(exceptions);
    } catch {
      setError("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMonths(); }, [loadMonths]);
  useEffect(() => { if (selectedMonth) loadExceptions(selectedMonth); }, [selectedMonth, loadExceptions]);

  const filtered = items.filter((item) => {
    if (filter === "ALL") return true;
    return item.validation?.riskLevel === filter;
  });

  function exportCsv() {
    const rows = [
      ["Month", "Payer Name", "Risk Level", "Status", "Issues", "Vendor Matched", "Contract Matched", "Reviewer Comment", "Escalated At"],
      ...filtered.map((item) => [
        selectedMonth,
        item.submission.payerName,
        item.validation?.riskLevel ?? "",
        item.validation?.statusCode ?? "",
        (item.validation?.issues ?? []).join("; "),
        item.validation?.vendorMatched ? "Yes" : "No",
        item.validation?.contractMatched ? "Yes" : "No",
        item.validation?.reviewerComment ?? "",
        item.validation?.escalatedAt ?? "",
      ]),
    ];
    const csv    = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob   = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement("a");
    a.href       = url;
    a.download   = `exceptions_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const blocked     = items.filter((i) => i.validation?.riskLevel === "BLOCKED").length;
  const needsReview = items.filter((i) => i.validation?.riskLevel === "NEEDS_REVIEW").length;

  return (
    <AppShell>
      <PageHeader
        title="Exception Report"
        subtitle="Invoices requiring attention — BLOCKED or NEEDS REVIEW"
        actions={
          <div className="flex items-center gap-3">
            <select
              value={selectedMonth}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
              Export CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Total Exceptions" value={items.length} color="stone" />
        <SummaryCard label="Blocked" value={blocked} color="red" />
        <SummaryCard label="Needs Review" value={needsReview} color="amber" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(["ALL", "BLOCKED", "NEEDS_REVIEW"] as FilterLevel[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
              filter === f
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {f === "ALL" ? "All" : f === "BLOCKED" ? "Blocked" : "Needs Review"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">
            {items.length === 0 ? "No exceptions found for this month." : "No items match the current filter."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Payer</th>
                  <th className="px-4 py-3 text-left">Risk Level</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Contract</th>
                  <th className="px-4 py-3 text-left">Issues</th>
                  <th className="px-4 py-3 text-left">Comment</th>
                  <th className="px-4 py-3 text-left">Escalated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((item) => {
                  const v = item.validation;
                  return (
                    <tr key={item.submission.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3 font-medium text-stone-800">{item.submission.payerName}</td>
                      <td className="px-4 py-3">
                        <RiskBadge level={v?.riskLevel} />
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500 font-mono">{v?.statusCode ?? "—"}</td>
                      <td className="px-4 py-3">
                        {v?.vendorMatched
                          ? <span className="text-green-600 text-xs font-semibold">✓</span>
                          : <span className="text-red-500 text-xs font-semibold">✗</span>}
                      </td>
                      <td className="px-4 py-3">
                        {v?.contractMatched
                          ? <span className="text-green-600 text-xs font-semibold">✓</span>
                          : <span className="text-red-500 text-xs font-semibold">✗</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500 max-w-xs">
                        {v?.issues?.length ? v.issues.join(", ") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-600 max-w-xs italic">
                        {v?.reviewerComment ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-400">
                        {v?.escalatedAt ? new Date(v.escalatedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: "stone" | "red" | "amber" }) {
  const colors = {
    stone: "bg-stone-50 border-stone-200 text-stone-800",
    red:   "bg-red-50 border-red-200 text-red-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
  };
  return (
    <div className={`rounded-xl border px-5 py-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function RiskBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-stone-400 text-xs">—</span>;
  const styles: Record<string, string> = {
    BLOCKED:      "bg-red-100 text-red-700",
    NEEDS_REVIEW: "bg-amber-100 text-amber-700",
    OK:           "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles[level] ?? "bg-stone-100 text-stone-600"}`}>
      {level}
    </span>
  );
}
