"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import type { TrashedItem, TrashEntityType } from "@/types";

const TYPE_LABEL_KEYS: Record<TrashEntityType, "trash_type_invoice" | "trash_type_expense" | "trash_type_proposal" | "trash_type_client" | "trash_type_lead"> = {
  invoice:  "trash_type_invoice",
  expense:  "trash_type_expense",
  proposal: "trash_type_proposal",
  client:   "trash_type_client",
  lead:     "trash_type_lead",
};

const TYPE_COLORS: Record<TrashEntityType, string> = {
  invoice:  "bg-blue-50 text-blue-700 border-blue-200",
  expense:  "bg-amber-50 text-amber-700 border-amber-200",
  proposal: "bg-violet-50 text-violet-700 border-violet-200",
  client:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  lead:     "bg-rose-50 text-rose-700 border-rose-200",
};

const FILTER_OPTIONS: Array<"all" | TrashEntityType> = [
  "all", "invoice", "expense", "proposal", "client", "lead",
];

export default function TrashPage() {
  const { t } = useLanguage();
  const [items, setItems]           = useState<TrashedItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterType, setFilterType] = useState<"all" | TrashEntityType>("all");
  const [error, setError]           = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [restoring, setRestoring]   = useState<string | null>(null);
  const [purging, setPurging]       = useState<string | null>(null);
  const [emptyingAll, setEmptyingAll] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/trash");
      const data = await res.json() as { items?: TrashedItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRestore(trashId: string, name: string) {
    setRestoring(trashId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res  = await fetch(`/api/trash/${trashId}`, { method: "POST" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("trash_restore_failed"));
      setItems((prev) => prev.filter((i) => i.trashId !== trashId));
      setSuccessMsg(t("trash_restore_success", { name }));
    } catch (e) {
      setError(String(e));
    } finally {
      setRestoring(null);
    }
  }

  async function handlePurge(trashId: string) {
    setPurging(trashId);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${trashId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("trash_purge_failed"));
      setItems((prev) => prev.filter((i) => i.trashId !== trashId));
    } catch (e) {
      setError(String(e));
    } finally {
      setPurging(null);
    }
  }

  async function handleEmptyTrash() {
    setEmptyingAll(true);
    setError(null);
    try {
      const res = await fetch("/api/trash", { method: "DELETE" });
      if (!res.ok) throw new Error(t("trash_empty_failed"));
      setItems([]);
      setConfirmEmpty(false);
      setSuccessMsg(t("trash_emptied_success"));
    } catch (e) {
      setError(String(e));
    } finally {
      setEmptyingAll(false);
    }
  }

  const filtered = filterType === "all"
    ? items
    : items.filter((i) => i.entityType === filterType);

  const countByType = (type: TrashEntityType) =>
    items.filter((i) => i.entityType === type).length;

  return (
    <AppShell>
      <PageHeader
        title={t("trash_title")}
        subtitle={t("trash_subtitle", { count: items.length })}
        actions={
          items.length > 0 ? (
            <button
              onClick={() => setConfirmEmpty(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
            >
              <TrashIcon />
              {t("trash_empty_button")}
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 flex justify-between">
          {successMsg}
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-600">×</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {FILTER_OPTIONS.map((type) => {
          const count = type === "all" ? items.length : countByType(type);
          const active = filterType === type;
          return (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all capitalize ${
                active
                  ? "bg-[#1a1a2e] text-white border-[#1a1a2e]"
                  : "bg-white text-stone-500 border-stone-200 hover:border-stone-300"
              }`}
            >
              {type === "all" ? t("trash_filter_all") : t(TYPE_LABEL_KEYS[type])}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                active ? "bg-white/20 text-white" : "bg-stone-100 text-stone-500"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-stone-400 text-sm">
          {t("loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="text-5xl mb-4">🗑️</div>
          <p className="text-stone-500 font-medium">
            {items.length === 0 ? t("trash_empty_state_title_empty") : t("trash_empty_state_title_filtered")}
          </p>
          <p className="text-stone-400 text-sm mt-1">
            {items.length === 0
              ? t("trash_empty_state_desc_empty")
              : t("trash_empty_state_desc_filtered", { count: items.length })}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr className="border-b border-stone-100">
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("trash_col_type")}</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("trash_col_name")}</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("trash_col_deleted")}</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{t("trash_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {filtered.map((item) => {
                const isRestoring = restoring === item.trashId;
                const isPurging   = purging   === item.trashId;
                const deletedDate = new Date(item.deletedAt);
                const daysAgo     = Math.floor((Date.now() - deletedDate.getTime()) / 86400000);
                const dateLabel   = daysAgo === 0
                  ? t("trash_date_today")
                  : daysAgo === 1
                  ? t("trash_date_yesterday")
                  : t("trash_date_days_ago", { days: daysAgo });

                return (
                  <tr key={item.trashId} className="hover:bg-stone-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[item.entityType]}`}>
                        {t(TYPE_LABEL_KEYS[item.entityType])}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-800 max-w-[340px]">
                      <span className="block truncate" title={item.entityName}>{item.entityName}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                      <span title={deletedDate.toLocaleString()}>{dateLabel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={isRestoring}
                          onClick={() => handleRestore(item.trashId, item.entityName)}
                          className="border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs"
                        >
                          ↩ {t("trash_restore")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={isPurging}
                          onClick={() => handlePurge(item.trashId)}
                          className="text-red-400 hover:text-red-600 hover:bg-red-50 text-xs"
                        >
                          {t("trash_delete_permanently")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-stone-100 bg-stone-50">
            <p className="text-xs text-stone-400">
              {t("trash_footer_shown", { filtered: filtered.length, total: items.length })}
              {" · "}{t("trash_footer_note")}
            </p>
          </div>
        </div>
      )}

      {/* Empty trash confirmation */}
      {confirmEmpty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold text-stone-900">{t("trash_confirm_empty_title")}</h2>
            <p className="mb-6 text-sm text-stone-500">
              {t("trash_confirm_empty_desc", { count: items.length })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmEmpty(false)}
                disabled={emptyingAll}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleEmptyTrash}
                disabled={emptyingAll}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {emptyingAll ? t("trash_confirm_empty_deleting") : t("trash_confirm_empty_button")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function TrashIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
