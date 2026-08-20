"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import clsx from "clsx";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import type { MonthlyChecklistItem, BankSyncStatus, ChecklistItemStatus } from "@/types";

const CATEGORIES = ["invoices", "expenses", "outbound", "bank", "tax", "payroll", "reporting"];
const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  invoices:  "close_category_invoices",
  expenses:  "expenses_title",
  outbound:  "nav_outbound_invoices",
  bank:      "close_category_bank",
  tax:       "close_category_tax",
  payroll:   "close_category_payroll",
  reporting: "close_category_reporting",
};

const STATUS_ICON: Record<ChecklistItemStatus, string> = {
  pending:     "○",
  in_progress: "◑",
  done:        "✓",
  blocked:     "✗",
  na:          "–",
  skipped:     "—",
};

const BANK_SYNC_COLOR: Record<string, string> = {
  ok:      "text-green-600",
  warning: "text-amber-600",
  error:   "text-red-600",
  unknown: "text-stone-400",
};

function monthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

export default function ClosePage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const months = monthOptions();
  const [month, setMonth]         = useState(months[0]);
  const [checklist, setChecklist] = useState<MonthlyChecklistItem[]>([]);
  const [bankSync, setBankSync]   = useState<BankSyncStatus | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState<string | null>(null);
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/close?month=${month}`);
    const data = await res.json() as { checklist: MonthlyChecklistItem[]; bankSync: BankSyncStatus };
    setChecklist(data.checklist ?? []);
    setBankSync(data.bankSync ?? null);
    setLoading(false);
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  async function toggleItem(item: MonthlyChecklistItem) {
    const nextStatus: ChecklistItemStatus =
      item.status === "pending" ? "done" : item.status === "done" ? "skipped" : "pending";
    setSaving(item.id);
    try {
      await fetch("/api/close", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          month: item.month,
          status: nextStatus,
          completedAt: nextStatus === "done" ? new Date().toISOString() : undefined,
          completedBy: nextStatus === "done" ? "reviewer" : undefined,
        }),
      });
      notify("success", `Marked "${item.title}" as ${nextStatus} for ${item.month}`, "/close");
      await load();
    } catch (err) {
      notify("error", `Failed to update "${item.title}" for ${item.month}: ${String(err)}`, "/close");
    } finally {
      setSaving(null);
    }
  }

  async function saveNote(item: MonthlyChecklistItem) {
    setSaving(item.id);
    try {
      await fetch("/api/close", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, month: item.month, notes: noteValue }),
      });
      notify("success", `Saved note for "${item.title}" (${item.month})`, "/close");
      await load();
    } catch (err) {
      notify("error", `Failed to save note for "${item.title}": ${String(err)}`, "/close");
    } finally {
      setNoteEditing(null);
      setSaving(null);
    }
  }

  const completedCount = checklist.filter((i) => i.status === "done").length;
  const totalCount     = checklist.length;
  const progress       = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    items: checklist.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{t("nav_close_checklist")}</h1>
            <p className="mt-1 text-sm text-stone-500">{t("close_subtitle")}</p>
          </div>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-700 bg-white"
          >
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Bank sync status */}
        {bankSync && (
          <div className={clsx(
            "rounded-xl border p-4 flex items-start gap-3",
            bankSync.status === "ok"      ? "border-green-100 bg-green-50" :
            bankSync.status === "warning" ? "border-amber-100 bg-amber-50" :
            bankSync.status === "error"   ? "border-red-100 bg-red-50" :
            "border-stone-100 bg-stone-50",
          )}>
            <div className={clsx("mt-0.5 text-xl", BANK_SYNC_COLOR[bankSync.status])}>
              {bankSync.status === "ok" ? "✓" : bankSync.status === "error" ? "✗" : "!"}
            </div>
            <div>
              <p className="font-medium text-stone-800 text-sm">{t("close_bank_sync_label")}</p>
              <p className={clsx("text-xs mt-0.5", BANK_SYNC_COLOR[bankSync.status])}>{bankSync.message}</p>
              {bankSync.lastSyncAt && (
                <p className="text-xs text-stone-400 mt-1">{t("close_last_sync").replace("{date}", bankSync.lastSyncAt.slice(0, 10))}</p>
              )}
              {(bankSync.unresolvedCount ?? 0) > 0 && (
                <p className="text-xs text-red-600 mt-1">{t("close_unresolved_items").replace("{count}", String(bankSync.unresolvedCount))}</p>
              )}
            </div>
          </div>
        )}

        {/* Progress */}
        <div className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-stone-700">{t("close_progress_label")}</p>
            <p className="text-sm font-bold text-stone-900">{completedCount} / {totalCount} ({progress}%)</p>
          </div>
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
            <div
              className="h-2 rounded-full bg-[#1a3d2b] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {progress === 100 && (
            <p className="mt-2 text-xs text-green-600 font-medium">{t("close_complete_label")}</p>
          )}
        </div>

        {/* Checklist by category */}
        {loading ? (
          <p className="text-sm text-stone-400 py-8 text-center">{t("loading")}</p>
        ) : (
          <div className="space-y-4">
            {byCategory.map(({ cat, items }) => (
              <div key={cat} className="rounded-xl border border-stone-100 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat}
                  </p>
                </div>
                <ul className="divide-y divide-stone-50">
                  {items.map((item) => (
                    <li key={item.id} className="px-4 py-3 flex items-start gap-3">
                      <button
                        onClick={() => { void toggleItem(item); }}
                        disabled={saving === item.id}
                        className={clsx(
                          "mt-0.5 h-5 w-5 shrink-0 rounded border text-xs font-bold flex items-center justify-center transition",
                          item.status === "done"    ? "border-green-500 bg-green-500 text-white" :
                          item.status === "skipped" ? "border-stone-300 bg-stone-100 text-stone-400" :
                          item.status === "blocked" ? "border-red-400 bg-red-50 text-red-500" :
                          "border-stone-300 text-stone-300 hover:border-[#1a3d2b]",
                        )}
                        title={t("close_status_tooltip").replace("{status}", item.status)}
                      >
                        {saving === item.id ? "…" : STATUS_ICON[item.status]}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={clsx("text-sm", item.status === "done" ? "line-through text-stone-400" : "text-stone-800")}>
                          {item.title}
                        </p>
                        {item.completedBy && item.status === "done" && (
                          <p className="text-xs text-stone-400 mt-0.5">
                            {t("close_completed_by").replace("{name}", item.completedBy)}
                            {item.completedAt ? ` · ${item.completedAt.slice(0, 10)}` : ""}
                          </p>
                        )}
                        {noteEditing === item.id ? (
                          <div className="mt-2 flex gap-2">
                            <input
                              autoFocus
                              value={noteValue}
                              onChange={(e) => setNoteValue(e.target.value)}
                              className="flex-1 rounded border border-stone-200 px-2 py-1 text-xs text-stone-700"
                              placeholder={t("close_note_placeholder")}
                            />
                            <button onClick={() => { void saveNote(item); }} className="text-xs text-[#1a3d2b] font-medium">{t("close_save_button")}</button>
                            <button onClick={() => setNoteEditing(null)} className="text-xs text-stone-400">{t("cancel")}</button>
                          </div>
                        ) : item.notes ? (
                          <p className="text-xs text-stone-500 mt-0.5 italic">
                            {item.notes}
                            <button onClick={() => { setNoteEditing(item.id); setNoteValue(item.notes ?? ""); }} className="ml-2 text-stone-400 not-italic hover:text-stone-600">{t("close_edit_button")}</button>
                          </p>
                        ) : (
                          <button onClick={() => { setNoteEditing(item.id); setNoteValue(""); }} className="text-xs text-stone-300 hover:text-stone-500 mt-0.5">
                            {t("close_add_note_button")}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
