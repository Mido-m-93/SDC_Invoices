"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage, type TranslationKey } from "@/translations";
import type { MonthlyCloseChecklist, CloseChecklistItem, CloseChecklistItemStatus } from "@/types";

const STATUS_CONFIG: Record<CloseChecklistItemStatus, { color: string; bg: string }> = {
  pending:     { color: "text-stone-500",  bg: "bg-stone-100" },
  in_progress: { color: "text-blue-700",   bg: "bg-blue-100" },
  done:        { color: "text-green-700",  bg: "bg-green-100" },
  blocked:     { color: "text-red-700",    bg: "bg-red-100" },
  na:          { color: "text-stone-400",  bg: "bg-stone-50" },
  skipped:     { color: "text-stone-400",  bg: "bg-stone-50" },
};

const CATEGORIES = ["bank", "invoices", "expenses", "vendors", "mf", "tax", "report"];
const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  bank: "close_checklist_category_bank",
  invoices: "close_checklist_category_invoices",
  expenses: "close_checklist_category_expenses",
  vendors: "close_checklist_category_vendors",
  mf: "close_checklist_category_mf",
  tax: "close_checklist_category_tax",
  report: "close_checklist_category_report",
};

export default function CloseChecklistPage() {
  const { t, language } = useLanguage();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [checklist, setChecklist] = useState<MonthlyCloseChecklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notesEditing, setNotesEditing] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [actorName, setActorName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/close-checklist?month=${month}`);
      const data = await res.json() as { checklist: MonthlyCloseChecklist };
      setChecklist(data.checklist ?? null);
    } catch { setError(t("close_checklist_load_failed")); }
    finally { setLoading(false); }
  }, [month, t]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(item: CloseChecklistItem, status: CloseChecklistItemStatus) {
    setUpdatingId(item.id);
    try {
      await fetch(`/api/close-checklist/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, completedBy: actorName || undefined }),
      });
      load();
    } catch { setError(t("close_checklist_update_failed")); }
    finally { setUpdatingId(null); }
  }

  async function saveNotes(id: string) {
    try {
      await fetch(`/api/close-checklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesValue }),
      });
      setNotesEditing(null);
      load();
    } catch { setError(t("close_checklist_notes_failed")); }
  }

  async function handleReset() {
    if (!confirm(t("close_checklist_reset_confirm").replace("{month}", month))) return;
    await fetch(`/api/close-checklist?month=${month}`, { method: "DELETE" });
    load();
  }

  const itemsByCategory = checklist
    ? CATEGORIES.reduce((acc, cat) => {
        acc[cat] = checklist.items.filter((i) => i.category === cat);
        return acc;
      }, {} as Record<string, CloseChecklistItem[]>)
    : {};

  const progress = checklist ? Math.round((checklist.doneItems / Math.max(checklist.totalItems, 1)) * 100) : 0;

  return (
    <AppShell>
      <PageHeader
        title={t("close_checklist_title")}
        subtitle={t("close_checklist_subtitle")}
        actions={
          <div className="flex gap-2 items-center">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
            />
            <Button variant="secondary" size="sm" onClick={handleReset}>{t("close_checklist_reset_button")}</Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}<button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Actor name field */}
      <div className="mb-5 flex items-center gap-3">
        <label className="text-xs text-stone-500 shrink-0">{t("close_checklist_actor_label")}</label>
        <input
          value={actorName}
          onChange={(e) => setActorName(e.target.value)}
          placeholder={t("close_checklist_actor_placeholder")}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
        />
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : checklist ? (
        <div className="space-y-5">
          {/* Progress bar */}
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-stone-700">{t("close_checklist_items_complete").replace("{done}", String(checklist.doneItems)).replace("{total}", String(checklist.totalItems))}</span>
              <span className="text-sm font-bold text-[#1a3d2b]">{progress}%</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2d6a4f] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            {checklist.blockedItems > 0 && (
              <p className="mt-2 text-xs text-red-600">{t("close_checklist_blocked_items").replace("{count}", String(checklist.blockedItems))}</p>
            )}
            {checklist.completedAt && (
              <p className="mt-2 text-xs text-green-600">{t("close_checklist_completed_label")}</p>
            )}
          </div>

          {/* Items by category */}
          {CATEGORIES.map((cat) => {
            const items = itemsByCategory[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
                  <h3 className="text-sm font-semibold text-stone-700">{CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat}</h3>
                </div>
                <div className="divide-y divide-stone-50">
                  {items.map((item) => {
                    const sc = STATUS_CONFIG[item.status];
                    const statusLabel = t(`close_checklist_status_${item.status}` as TranslationKey);
                    const displayTitle = language === "ja" ? (item.titleJa || item.title) : item.title;
                    return (
                      <div key={item.id} className={`px-5 py-4 ${item.status === "done" || item.status === "na" ? "opacity-60" : ""}`}>
                        <div className="flex items-start gap-3">
                          {/* Status toggle button */}
                          <button
                            disabled={updatingId === item.id}
                            onClick={() => {
                              const next: CloseChecklistItemStatus = item.status === "pending" ? "in_progress"
                                : item.status === "in_progress" ? "done"
                                : item.status === "done" ? "pending"
                                : item.status === "blocked" ? "pending"
                                : "pending";
                              updateStatus(item, next);
                            }}
                            className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition ${
                              item.status === "done" ? "bg-green-500 border-green-500" :
                              item.status === "in_progress" ? "border-blue-500" :
                              item.status === "blocked" ? "border-red-500" :
                              item.status === "na" ? "border-stone-300" :
                              "border-stone-300 hover:border-[#2d6a4f]"
                            }`}
                          >
                            {item.status === "done" && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.5"/></svg>}
                            {item.status === "in_progress" && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                            {item.status === "blocked" && <span className="h-2 w-2 rounded-full bg-red-500" />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${item.status === "done" || item.status === "na" ? "line-through text-stone-400" : "text-stone-800"}`}>
                                {displayTitle}
                              </span>
                              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.color}`}>
                                {statusLabel}
                              </span>
                            </div>
                            <p className="text-xs text-stone-400 mt-0.5">{item.description}</p>
                            {item.completedBy && (
                              <p className="text-xs text-stone-400 mt-0.5">{t("close_checklist_completed_by").replace("{name}", item.completedBy)}{item.completedAt ? ` (${item.completedAt.slice(0, 10)})` : ""}</p>
                            )}
                            {/* Notes */}
                            {notesEditing === item.id ? (
                              <div className="mt-2 flex gap-2">
                                <input
                                  autoFocus
                                  value={notesValue}
                                  onChange={(e) => setNotesValue(e.target.value)}
                                  className="flex-1 rounded border border-stone-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#2d6a4f]/30"
                                  placeholder={t("close_checklist_notes_placeholder")}
                                />
                                <button onClick={() => saveNotes(item.id)} className="text-xs text-[#2d6a4f] font-medium hover:underline">{t("close_checklist_save_button")}</button>
                                <button onClick={() => setNotesEditing(null)} className="text-xs text-stone-400 hover:text-stone-600">{t("cancel")}</button>
                              </div>
                            ) : (
                              <div className="mt-1 flex items-center gap-2">
                                {item.notes && <span className="text-xs text-stone-500 italic">{item.notes}</span>}
                                <button
                                  onClick={() => { setNotesEditing(item.id); setNotesValue(item.notes); }}
                                  className="text-xs text-stone-400 hover:text-stone-600 underline"
                                >
                                  {item.notes ? t("close_checklist_edit_note_button") : t("close_checklist_add_note_button")}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Quick status buttons */}
                          <div className="flex gap-1 shrink-0">
                            {item.status !== "blocked" && (
                              <button
                                onClick={() => updateStatus(item, "blocked")}
                                className="text-xs text-red-400 hover:text-red-600 px-1"
                                title={t("close_checklist_mark_blocked_tooltip")}
                              >
                                {t("close_checklist_block_button")}
                              </button>
                            )}
                            {item.status !== "na" && (
                              <button
                                onClick={() => updateStatus(item, "na")}
                                className="text-xs text-stone-400 hover:text-stone-600 px-1"
                                title={t("close_checklist_mark_na_tooltip")}
                              >
                                {t("close_checklist_na_button")}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("close_checklist_empty_label")}</p>
        </div>
      )}
    </AppShell>
  );
}
