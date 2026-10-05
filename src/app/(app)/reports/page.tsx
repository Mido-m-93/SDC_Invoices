"use client";

import { useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { useLanguage, type TranslationKey } from "@/translations";
import type { ExpenseClaim, ExpenseCategory } from "@/types";
import { formatTimestamp } from "@/lib/utils";

export default function ReportsPage() {
  const { t, language } = useLanguage();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryLabel = (c: ExpenseCategory) => t(`expenses_category_${c}` as TranslationKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/expenses");
      const data = await res.json() as { claims?: ExpenseClaim[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setClaims((data.claims ?? []).filter((c) => !!c.filedStoragePath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = [...claims].sort((a, b) => (b.filedAt ?? "").localeCompare(a.filedAt ?? ""));

  return (
    <>
      <PageHeader title={t("reports_title")} subtitle={t("reports_subtitle")} />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("reports_loading")}</p>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("reports_empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("expenses_col_submitted_by")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_category")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_amount")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("reports_col_saved_at")}</th>
                <th className="px-4 py-3 text-left">{t("reports_col_receipt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{c.submittedBy || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{categoryLabel(c.category)}</td>
                  <td className="px-4 py-3">{c.currency} {c.amount.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={c.status === "paid" ? "text-emerald-600 font-medium" : "text-amber-600"}>
                      {t(`expenses_status_${c.status}` as TranslationKey)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-500">{c.filedAt ? formatTimestamp(c.filedAt, language) : "—"}</td>
                  <td className="px-4 py-3">
                    <a href={`/api/expenses/${c.id}/receipt-file`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#1a3d2b] font-medium hover:underline">
                      {t("reports_view_receipt")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
