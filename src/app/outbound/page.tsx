"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import clsx from "clsx";
import { useLanguage, type TranslationKey } from "@/translations";
import type { OutboundInvoice, OutboundStatus } from "@/types";

const STATUS_COLORS: Record<OutboundStatus, string> = {
  draft:            "bg-stone-100 text-stone-600",
  pending_approval: "bg-amber-50 text-amber-700",
  sent:             "bg-blue-50 text-blue-700",
  paid:             "bg-green-50 text-green-700",
  overdue:          "bg-red-50 text-red-700",
  cancelled:        "bg-stone-100 text-stone-500",
};

type FilterStatus = "all" | OutboundStatus;

export default function OutboundPage() {
  const { t } = useLanguage();
  const statusLabel = (s: FilterStatus) => t(`outbound_status_${s}` as TranslationKey);

  const [invoices, setInvoices]       = useState<OutboundInvoice[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<FilterStatus>("all");
  const [showForm, setShowForm]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [selected, setSelected]       = useState<OutboundInvoice | null>(null);
  const [updatingStatus, setUpdating] = useState(false);

  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    projectName: "",
    amount: "",
    currency: "JPY",
    billingDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter !== "all" ? `?status=${filter}` : "";
    const res  = await fetch(`/api/outbound${params}`);
    const data = await res.json() as { invoices: OutboundInvoice[] };
    setInvoices(data.invoices ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) || 0 }),
    });
    setForm({ clientName: "", clientEmail: "", projectName: "", amount: "", currency: "JPY", billingDate: new Date().toISOString().slice(0, 10), dueDate: "", notes: "" });
    setShowForm(false);
    setSubmitting(false);
    await load();
  }

  async function markStatus(id: string, status: OutboundStatus) {
    setUpdating(true);
    await fetch(`/api/outbound/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(status === "paid" ? { paidAt: new Date().toISOString() } : {}) }),
    });
    setSelected(null);
    setUpdating(false);
    await load();
  }

  const counts = {
    all: invoices.length,
    draft: invoices.filter((i) => i.status === "draft").length,
    sent: invoices.filter((i) => i.status === "sent").length,
    paid: invoices.filter((i) => i.status === "paid").length,
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };
  const totalUnpaid = invoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + (i.amount ?? i.total ?? 0), 0);

  const filtered = filter === "all" ? invoices : invoices.filter((i) => i.status === filter);

  const tableHeaders = [
    t("outbound_col_client"),
    t("outbound_col_project"),
    t("outbound_col_amount"),
    t("outbound_col_billing_date"),
    t("outbound_col_due_date"),
    t("col_status"),
    "",
  ];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{t("nav_outbound_invoices")}</h1>
            <p className="mt-1 text-sm text-stone-500">{t("outbound_subtitle")}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-[#1a3d2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3d2b]/90"
          >
            {t("outbound_new_invoice")}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t("outbound_status_draft"), value: counts.draft, color: "text-stone-600" },
            { label: t("outbound_stat_sent_unpaid"), value: counts.sent, color: "text-blue-600" },
            { label: t("outbound_status_overdue"), value: counts.overdue, color: "text-red-600" },
            { label: t("outbound_stat_outstanding"), value: `¥${totalUnpaid.toLocaleString()}`, color: "text-amber-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-stone-400">{s.label}</p>
              <p className={clsx("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 border-b border-stone-200">
          {(["all", "draft", "sent", "paid", "overdue"] as FilterStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "px-3 py-2 text-xs font-medium border-b-2 transition",
                filter === s ? "border-[#1a3d2b] text-[#1a3d2b]" : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {statusLabel(s)} <span className="text-stone-400">({s === "all" ? counts.all : (counts[s as keyof typeof counts] ?? 0)})</span>
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-sm text-stone-400 py-8 text-center">{t("loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-stone-400 py-8 text-center">{t("no_data")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-100 shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-400">
                <tr>
                  {tableHeaders.map((h, idx) => (
                    <th key={idx} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-800">{inv.clientName}</p>
                      {inv.clientEmail && <p className="text-xs text-stone-400">{inv.clientEmail}</p>}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{inv.projectName}</td>
                    <td className="px-4 py-3 font-mono text-stone-700">¥{(inv.amount ?? inv.total ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-stone-500">{inv.billingDate ?? inv.issueDate}</td>
                    <td className="px-4 py-3 text-stone-500">{inv.dueDate || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[inv.status as OutboundStatus] ?? STATUS_COLORS.draft)}>
                        {statusLabel(inv.status as OutboundStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(inv)}
                        className="text-xs text-[#1a3d2b] underline hover:no-underline"
                      >
                        {t("outbound_action_manage")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">{t("outbound_modal_new_title")}</h2>
            <form onSubmit={(e) => { void submit(e); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_client_name")}</label>
                  <input required className="input-base" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_client_email")}</label>
                  <input type="email" className="input-base" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_project_name")}</label>
                <input required className="input-base" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_amount")}</label>
                  <input type="number" required min={1} className="input-base" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_billing_date")}</label>
                  <input type="date" required className="input-base" value={form.billingDate} onChange={(e) => setForm({ ...form, billingDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t("outbound_col_due_date")}</label>
                <input type="date" className="input-base" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t("outbound_field_notes")}</label>
                <textarea rows={2} className="input-base resize-none" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-[#1a3d2b] py-2 text-sm font-medium text-white disabled:opacity-50">
                  {submitting ? t("outbound_creating") : t("outbound_create_invoice")}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-stone-200 py-2 text-sm font-medium text-stone-600">
                  {t("cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage status modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-stone-900">{t("outbound_manage_modal_title")}</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">{t("outbound_col_client")}</dt><dd className="font-medium">{selected.clientName}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">{t("outbound_col_project")}</dt><dd>{selected.projectName}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">{t("outbound_col_amount")}</dt><dd className="font-mono">¥{(selected.amount ?? selected.total ?? 0).toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">{t("outbound_col_due_date")}</dt><dd>{selected.dueDate || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">{t("col_status")}</dt>
                <dd><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[selected.status as OutboundStatus] ?? STATUS_COLORS.draft)}>{statusLabel(selected.status as OutboundStatus)}</span></dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {selected.status === "draft" && (
                <button disabled={updatingStatus} onClick={() => { void markStatus(selected.id, "sent"); }} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {t("outbound_action_mark_sent")}
                </button>
              )}
              {(selected.status === "sent" || selected.status === "overdue") && (
                <button disabled={updatingStatus} onClick={() => { void markStatus(selected.id, "paid"); }} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {t("outbound_action_mark_paid")}
                </button>
              )}
              <button disabled={updatingStatus} onClick={() => { void markStatus(selected.id, "cancelled"); }} className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 disabled:opacity-50">
                {t("outbound_action_cancel_invoice")}
              </button>
              <button onClick={() => setSelected(null)} className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600">
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .input-base {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e7e5e4;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          color: #1c1917;
          background: white;
          outline: none;
        }
        .input-base:focus {
          border-color: #1a3d2b;
          box-shadow: 0 0 0 2px rgba(26,61,43,0.1);
        }
      `}</style>
    </AppShell>
  );
}
