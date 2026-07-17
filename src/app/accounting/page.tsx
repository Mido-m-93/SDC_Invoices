"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import { useLanguage } from "@/translations";
import type {
  AccountingEntry,
  AccountingEntryType,
  AccountingEntryStatus,
  ProfitAndLoss,
  AccountingSummary,
} from "@/types";
import { generateId } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "journal" | "pl";

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTRY_TYPES: AccountingEntryType[] = ["revenue", "expense", "adjustment", "transfer"];

const TYPE_COLORS: Record<AccountingEntryType, string> = {
  revenue: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
  adjustment: "bg-amber-100 text-amber-700",
  transfer: "bg-blue-100 text-blue-700",
};

const STATUS_COLORS: Record<AccountingEntryStatus, string> = {
  draft: "bg-stone-100 text-stone-500",
  posted: "bg-green-100 text-green-700",
  voided: "bg-red-100 text-red-700",
};

const CURRENCIES = ["JPY", "USD", "EUR", "GBP", "AUD", "SGD", "CNY"];

const SOURCE_TYPES = ["invoice", "expense", "payroll", "bank", "manual", "other"];

const currentMonth = () => new Date().toISOString().slice(0, 7);

const EMPTY_FORM: Omit<AccountingEntry, "id" | "month" | "createdAt" | "updatedAt"> = {
  entryDate: new Date().toISOString().slice(0, 10),
  type: "revenue",
  category: "",
  description: "",
  amount: 0,
  currency: "JPY",
  exchangeRate: 1,
  amountJpy: 0,
  status: "draft",
  sourceType: "",
  sourceId: "",
  clientId: "",
  vendorId: "",
  memberId: "",
  notes: "",
  postedBy: "",
  postedAt: null,
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>("journal");

  // Journal state
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [filterType, setFilterType] = useState<AccountingEntryType | "all">("all");
  const [filterStatus, setFilterStatus] = useState<AccountingEntryStatus | "all">("all");

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AccountingEntry | null>(null);
  const [form, setForm] = useState<Omit<AccountingEntry, "id" | "month" | "createdAt" | "updatedAt">>({ ...EMPTY_FORM });

  // P&L state
  const [plMonth, setPlMonth] = useState(currentMonth());
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [plLoading, setPlLoading] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: filterMonth });
      if (filterType !== "all") params.set("type", filterType);
      if (filterStatus !== "all") params.set("status", filterStatus);
      const res = await fetch(`/api/accounting?${params}`);
      const data = await res.json() as { entries: AccountingEntry[]; summary: AccountingSummary };
      setEntries(data.entries ?? []);
      setSummary(data.summary ?? null);
    } catch {
      setError(t("accounting_error_load_entries"));
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterType, filterStatus, t]);

  const loadPl = useCallback(async () => {
    setPlLoading(true);
    try {
      const res = await fetch(`/api/accounting/pl?month=${plMonth}`);
      const data = await res.json() as ProfitAndLoss;
      setPl(data);
    } catch {
      setError(t("accounting_error_load_pl"));
    } finally {
      setPlLoading(false);
    }
  }, [plMonth, t]);

  useEffect(() => {
    if (activeTab === "journal") loadEntries();
  }, [activeTab, loadEntries]);

  useEffect(() => {
    if (activeTab === "pl") loadPl();
  }, [activeTab, loadPl]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(entry: AccountingEntry) {
    setEditing(entry);
    setForm({
      entryDate: entry.entryDate,
      type: entry.type,
      category: entry.category,
      description: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      exchangeRate: entry.exchangeRate,
      amountJpy: entry.amountJpy,
      status: entry.status,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      clientId: entry.clientId,
      vendorId: entry.vendorId,
      memberId: entry.memberId,
      notes: entry.notes,
      postedBy: entry.postedBy,
      postedAt: entry.postedAt,
    });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const month = form.entryDate.slice(0, 7);
      const payload = { ...form, month };
      if (editing) {
        await fetch(`/api/accounting/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const id = generateId("acct");
        await fetch("/api/accounting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id }),
        });
      }
      setShowForm(false);
      loadEntries();
    } catch {
      setError(t("accounting_error_save"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePost(id: string) {
    try {
      await fetch(`/api/accounting/${id}/post`, { method: "POST" });
      loadEntries();
    } catch {
      setError(t("accounting_error_post"));
    }
  }

  async function handleVoid(id: string) {
    if (!confirm(t("accounting_confirm_void"))) return;
    try {
      await fetch(`/api/accounting/${id}/void`, { method: "POST" });
      loadEntries();
    } catch {
      setError(t("accounting_error_void"));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("accounting_confirm_delete"))) return;
    try {
      await fetch(`/api/accounting/${id}`, { method: "DELETE" });
      loadEntries();
    } catch {
      setError(t("accounting_error_delete"));
    }
  }

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-calculate amountJpy when amount or exchangeRate changes
      if (key === "amount" || key === "exchangeRate") {
        const amt = key === "amount" ? (value as number) : prev.amount;
        const rate = key === "exchangeRate" ? (value as number) : prev.exchangeRate;
        next.amountJpy = Math.round(amt * rate);
      }
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{t("accounting_title")}</h1>
          <p className="mt-1 text-sm text-stone-500">{t("accounting_subtitle")}</p>
        </div>
        {activeTab === "journal" && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1a3d2b] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#153325] focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/50 transition"
          >
            {t("accounting_add_entry")}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700 text-lg leading-none">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex border-b border-stone-200">
        {(["journal", "pl"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              activeTab === tab
                ? "border-[#1a3d2b] text-[#1a3d2b]"
                : "border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300"
            }`}
          >
            {tab === "journal" ? t("accounting_tab_journal") : t("accounting_tab_pl")}
          </button>
        ))}
      </div>

      {/* ── Journal Entries Tab ── */}
      {activeTab === "journal" && (
        <div>
          {/* Filter bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <label className="text-xs text-stone-500">{t("accounting_filter_month")}</label>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className={inp}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-xs text-stone-500">{t("accounting_filter_type")}</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as AccountingEntryType | "all")}
                className={inp}
              >
                <option value="all">{t("accounting_filter_all_types")}</option>
                {ENTRY_TYPES.map((et) => (
                  <option key={et} value={et}>{capitalize(et)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-xs text-stone-500">{t("accounting_filter_status")}</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as AccountingEntryStatus | "all")}
                className={inp}
              >
                <option value="all">{t("accounting_filter_all_statuses")}</option>
                <option value="draft">{t("accounting_status_draft")}</option>
                <option value="posted">{t("accounting_status_posted")}</option>
                <option value="voided">{t("accounting_status_voided")}</option>
              </select>
            </div>
          </div>

          {/* Summary bar */}
          {summary && (
            <div className="mb-5 grid grid-cols-3 gap-4">
              <SummaryCard label={t("accounting_summary_revenue")} value={summary.revenue} currency={summary.currency} color="text-green-700" bg="bg-green-50 border-green-100" />
              <SummaryCard label={t("accounting_summary_expenses")} value={summary.expenses} currency={summary.currency} color="text-red-700" bg="bg-red-50 border-red-100" />
              <SummaryCard label={t("accounting_summary_profit")} value={summary.profit} currency={summary.currency} color={summary.profit >= 0 ? "text-green-700" : "text-red-700"} bg="bg-stone-50 border-stone-200" />
            </div>
          )}

          {/* Table */}
          {loading ? (
            <p className="py-8 text-center text-sm text-stone-400">{t("loading")}</p>
          ) : entries.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
              <p className="text-sm text-stone-400">{t("accounting_empty_entries")}</p>
              <button
                onClick={openNew}
                className="mt-4 inline-flex items-center rounded-lg bg-[#1a3d2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#153325] transition"
              >
                {t("accounting_add_entry")}
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3 text-left">{t("accounting_col_date")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_type")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_category")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_description")}</th>
                      <th className="px-4 py-3 text-right">{t("accounting_col_amount")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_currency")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_status")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_source")}</th>
                      <th className="px-4 py-3 text-left">{t("accounting_col_actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-stone-50">
                        <td className="px-4 py-3 text-stone-600">{entry.entryDate}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[entry.type]}`}>
                            {capitalize(entry.type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-stone-600">{entry.category || t("none")}</td>
                        <td className="px-4 py-3 max-w-[220px] truncate text-stone-700" title={entry.description}>
                          {entry.description || t("none")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-stone-800">
                          {entry.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-stone-500">{entry.currency}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status]}`}>
                            {capitalize(entry.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs">
                          {entry.sourceType ? `${entry.sourceType}${entry.sourceId ? ` #${entry.sourceId}` : ""}` : t("none")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            <ActionBtn onClick={() => openEdit(entry)}>{t("accounting_action_edit")}</ActionBtn>
                            {entry.status === "draft" && (
                              <ActionBtn onClick={() => handlePost(entry.id)}>{t("accounting_action_post")}</ActionBtn>
                            )}
                            {(entry.status === "draft" || entry.status === "posted") && (
                              <ActionBtn onClick={() => handleVoid(entry.id)} danger>{t("accounting_action_void")}</ActionBtn>
                            )}
                            {entry.status === "draft" && (
                              <ActionBtn onClick={() => handleDelete(entry.id)} danger>{t("accounting_action_delete")}</ActionBtn>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── P&L Tab ── */}
      {activeTab === "pl" && (
        <div>
          {/* Month selector */}
          <div className="mb-5 flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <label className="text-xs text-stone-500">{t("accounting_pl_month_label")}</label>
              <input
                type="month"
                value={plMonth}
                onChange={(e) => setPlMonth(e.target.value)}
                className={inp}
              />
            </div>
          </div>

          {plLoading ? (
            <p className="py-8 text-center text-sm text-stone-400">{t("loading")}</p>
          ) : !pl ? (
            <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
              <p className="text-sm text-stone-400">{t("accounting_pl_empty")}</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <PlCard label={t("accounting_pl_total_revenue")} value={pl.totalRevenue} currency={pl.currency} color="text-green-700" bg="bg-green-50 border-green-100" />
                <PlCard label={t("accounting_pl_total_expenses")} value={pl.totalExpenses} currency={pl.currency} color="text-red-700" bg="bg-red-50 border-red-100" />
                <PlCard label={t("accounting_pl_gross_profit")} value={pl.grossProfit} currency={pl.currency} color={pl.grossProfit >= 0 ? "text-green-700" : "text-red-700"} bg="bg-stone-50 border-stone-200" />
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-medium text-stone-500">{t("accounting_pl_gross_margin_pct")}</p>
                  <p className={`mt-1 text-2xl font-bold ${pl.grossMarginPct >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {pl.grossMarginPct.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Category breakdown table */}
              {pl.byCategory.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                  <div className="border-b border-stone-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-stone-700">{t("accounting_pl_category_breakdown")}</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-4 py-3 text-left">{t("accounting_pl_col_category")}</th>
                        <th className="px-4 py-3 text-left">{t("accounting_pl_col_type")}</th>
                        <th className="px-4 py-3 text-right">{t("accounting_pl_col_total", { currency: pl.currency })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {pl.byCategory.map((row, i) => (
                        <tr key={i} className="hover:bg-stone-50">
                          <td className="px-4 py-3 text-stone-700">{row.category || t("none")}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[row.type]}`}>
                              {capitalize(row.type)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-stone-800">
                            {row.total.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Entry Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <h2 className="text-base font-semibold text-stone-900">
                {editing ? t("accounting_modal_edit_title") : t("accounting_modal_new_title")}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-xl leading-none text-stone-400 hover:text-stone-700"
              >
                ×
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("accounting_field_entry_date")}>
                    <input
                      type="date"
                      className={inp}
                      value={form.entryDate}
                      onChange={(e) => setField("entryDate", e.target.value)}
                    />
                  </Field>
                  <Field label={t("accounting_field_type")}>
                    <select
                      className={inp}
                      value={form.type}
                      onChange={(e) => setField("type", e.target.value as AccountingEntryType)}
                    >
                      {ENTRY_TYPES.map((et) => (
                        <option key={et} value={et}>{capitalize(et)}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("accounting_field_category")}>
                    <input
                      className={inp}
                      value={form.category}
                      onChange={(e) => setField("category", e.target.value)}
                      placeholder={t("accounting_field_category_placeholder")}
                    />
                  </Field>
                  <Field label={t("accounting_field_status")}>
                    <select
                      className={inp}
                      value={form.status}
                      onChange={(e) => setField("status", e.target.value as AccountingEntryStatus)}
                    >
                      <option value="draft">{t("accounting_status_draft")}</option>
                      <option value="posted">{t("accounting_status_posted")}</option>
                      <option value="voided">{t("accounting_status_voided")}</option>
                    </select>
                  </Field>
                </div>

                <Field label={t("accounting_field_description")}>
                  <textarea
                    className={`${inp} h-16 resize-none`}
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder={t("accounting_field_description_placeholder")}
                  />
                </Field>

                <div className="grid grid-cols-3 gap-4">
                  <Field label={t("accounting_field_amount")}>
                    <input
                      type="number"
                      className={inp}
                      value={form.amount}
                      onChange={(e) => setField("amount", parseFloat(e.target.value) || 0)}
                      min={0}
                      step="0.01"
                    />
                  </Field>
                  <Field label={t("accounting_field_currency")}>
                    <select
                      className={inp}
                      value={form.currency}
                      onChange={(e) => setField("currency", e.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("accounting_field_exchange_rate")}>
                    <input
                      type="number"
                      className={inp}
                      value={form.exchangeRate}
                      onChange={(e) => setField("exchangeRate", parseFloat(e.target.value) || 1)}
                      min={0}
                      step="0.0001"
                    />
                  </Field>
                </div>

                <Field label={t("accounting_field_amount_jpy")}>
                  <input
                    type="number"
                    className={`${inp} bg-stone-50 text-stone-500`}
                    value={form.amountJpy}
                    readOnly
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("accounting_field_source_type")}>
                    <select
                      className={inp}
                      value={form.sourceType}
                      onChange={(e) => setField("sourceType", e.target.value)}
                    >
                      <option value="">{t("accounting_field_source_type_none")}</option>
                      {SOURCE_TYPES.map((s) => (
                        <option key={s} value={s}>{capitalize(s)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("accounting_field_source_id")}>
                    <input
                      className={inp}
                      value={form.sourceId}
                      onChange={(e) => setField("sourceId", e.target.value)}
                      placeholder={t("accounting_field_source_id_placeholder")}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("accounting_field_client_id")}>
                    <input
                      className={inp}
                      value={form.clientId}
                      onChange={(e) => setField("clientId", e.target.value)}
                      placeholder={t("accounting_field_client_id_placeholder")}
                    />
                  </Field>
                  <Field label={t("accounting_field_vendor_id")}>
                    <input
                      className={inp}
                      value={form.vendorId}
                      onChange={(e) => setField("vendorId", e.target.value)}
                      placeholder={t("accounting_field_vendor_id_placeholder")}
                    />
                  </Field>
                </div>

                <Field label={t("accounting_field_notes")}>
                  <textarea
                    className={`${inp} h-16 resize-none`}
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    placeholder={t("accounting_field_notes_placeholder")}
                  />
                </Field>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-6 py-4">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center rounded-lg bg-[#1a3d2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#153325] disabled:opacity-50 transition"
              >
                {saving ? t("accounting_saving") : t("accounting_save_entry")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  currency,
  color,
  bg,
}: {
  label: string;
  value: number;
  currency: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>
        {currency} {value.toLocaleString()}
      </p>
    </div>
  );
}

function PlCard({
  label,
  value,
  currency,
  color,
  bg,
}: {
  label: string;
  value: number;
  currency: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-stone-400">{currency}</p>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs font-medium transition border ${
        danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-stone-200 text-stone-600 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500">{label}</label>
      {children}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const inp =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
