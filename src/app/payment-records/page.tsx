"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import type { PaymentRecord, PaymentRecordStatus } from "@/types";
import { generateId } from "@/lib/utils";
import { useLanguage } from "@/translations";

const STATUS_KEYS: Record<PaymentRecordStatus, "payment_records_status_pending" | "payment_records_status_confirmed" | "payment_records_status_failed" | "payment_records_status_reconciled"> = {
  pending: "payment_records_status_pending",
  confirmed: "payment_records_status_confirmed",
  failed: "payment_records_status_failed",
  reconciled: "payment_records_status_reconciled",
};

const STATUS_COLORS: Record<PaymentRecordStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-blue-50 text-blue-700",
  failed: "bg-red-50 text-red-700",
  reconciled: "bg-green-50 text-green-700",
};

const EMPTY: Omit<PaymentRecord, "id" | "createdAt"> = {
  invoiceId: "",
  contractId: "",
  vendorId: "",
  amount: 0,
  currency: "JPY",
  paymentDate: "",
  paymentMethod: "",
  referenceNumber: "",
  status: "pending",
  confirmedBy: "",
  notes: "",
};

export default function PaymentRecordsPage() {
  const { t } = useLanguage();
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<PaymentRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [viewingAttachmentId, setViewingAttachmentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payment-records");
      const data = await res.json() as { records: PaymentRecord[] };
      setRecords(data.records ?? []);
    } catch {
      setError(t("payment_records_load_error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowForm(true);
  }

  function openEdit(r: PaymentRecord) {
    setEditing(r);
    setForm({ invoiceId: r.invoiceId, contractId: r.contractId, vendorId: r.vendorId, amount: r.amount, currency: r.currency, paymentDate: r.paymentDate, paymentMethod: r.paymentMethod, referenceNumber: r.referenceNumber, status: r.status, confirmedBy: r.confirmedBy ?? "", notes: r.notes ?? "" });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/payment-records/${editing.id}` : "/api/payment-records";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { ...form, id: editing.id, createdAt: editing.createdAt }
        : { ...form, id: generateId("pay"), createdAt: new Date().toISOString() };
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setShowForm(false);
      load();
    } catch {
      setError(t("payment_records_save_error"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("payment_records_confirm_delete"))) return;
    await fetch(`/api/payment-records/${id}`, { method: "DELETE" });
    load();
  }

  async function handleViewAttachment(record: PaymentRecord) {
    setViewingAttachmentId(record.id);
    setError(null);
    try {
      const res = await fetch(`/api/payment-records/attachment?invoiceId=${encodeURIComponent(record.invoiceId)}`);
      const data = await res.json() as { url: string | null };
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        setError(t("payment_records_no_attachment"));
      }
    } catch {
      setError(t("payment_records_attachment_error"));
    } finally {
      setViewingAttachmentId(null);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{t("payment_records_title")}</h1>
            <p className="text-sm text-stone-500 mt-0.5">{t("payment_records_subtitle")}</p>
          </div>
          <button onClick={openNew} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium hover:bg-[#14301f] transition">
            {t("payment_records_add")}
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-stone-400">{t("loading")}</p>
        ) : records.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
            <p className="text-stone-400 text-sm">{t("payment_records_empty")}</p>
            <button onClick={openNew} className="mt-4 px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium">{t("payment_records_add_first")}</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_invoice_id")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_contract_id")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_vendor")}</th>
                  <th className="px-4 py-3 text-right">{t("payment_records_col_amount")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_date")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_method")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_ref")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_status")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_records_col_pdf")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">{r.invoiceId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">{r.contractId}</td>
                    <td className="px-4 py-3 text-stone-600">{r.vendorId}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{r.currency} {r.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-stone-500">{r.paymentDate}</td>
                    <td className="px-4 py-3 text-stone-600">{r.paymentMethod}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">{r.referenceNumber || t("none")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                        {t(STATUS_KEYS[r.status])}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleViewAttachment(r)}
                        disabled={viewingAttachmentId === r.id}
                        className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                      >
                        📄 {viewingAttachmentId === r.id ? t("loading") : t("payment_records_action_view_pdf")}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(r)} className="text-xs text-stone-500 hover:text-stone-800">{t("payment_records_action_edit")}</button>
                        <button onClick={() => handleDelete(r.id)} className="text-xs text-red-400 hover:text-red-600">{t("payment_records_action_delete")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
              <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-base font-semibold">{editing ? t("payment_records_modal_title_edit") : t("payment_records_modal_title_add")}</h2>
                <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <Field label={t("payment_records_field_invoice_id")}><input className={inp} value={form.invoiceId} onChange={e => set("invoiceId", e.target.value)} /></Field>
                <Field label={t("payment_records_field_contract_id")}><input className={inp} value={form.contractId} onChange={e => set("contractId", e.target.value)} /></Field>
                <Field label={t("payment_records_field_vendor_id")}><input className={inp} value={form.vendorId} onChange={e => set("vendorId", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("payment_records_field_amount")}><input type="number" className={inp} value={form.amount} onChange={e => set("amount", Number(e.target.value))} /></Field>
                  <Field label={t("payment_records_field_currency")}><select className={inp} value={form.currency} onChange={e => set("currency", e.target.value)}><option>JPY</option><option>USD</option><option>EUR</option></select></Field>
                </div>
                <Field label={t("payment_records_field_payment_date")}><input type="date" className={inp} value={form.paymentDate} onChange={e => set("paymentDate", e.target.value)} /></Field>
                <Field label={t("payment_records_field_payment_method")}><input className={inp} value={form.paymentMethod} onChange={e => set("paymentMethod", e.target.value)} placeholder={t("payment_records_field_payment_method_placeholder")} /></Field>
                <Field label={t("payment_records_field_reference_number")}><input className={inp} value={form.referenceNumber} onChange={e => set("referenceNumber", e.target.value)} /></Field>
                <Field label={t("payment_records_field_status")}>
                  <select className={inp} value={form.status} onChange={e => set("status", e.target.value as PaymentRecordStatus)}>
                    {(Object.keys(STATUS_KEYS) as PaymentRecordStatus[]).map((v) => <option key={v} value={v}>{t(STATUS_KEYS[v])}</option>)}
                  </select>
                </Field>
                <Field label={t("payment_records_field_confirmed_by")}><input className={inp} value={form.confirmedBy} onChange={e => set("confirmedBy", e.target.value)} /></Field>
                <Field label={t("payment_records_field_notes")}><textarea className={`${inp} h-16 resize-none`} value={form.notes} onChange={e => set("notes", e.target.value)} /></Field>
              </div>
              <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">{t("cancel")}</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? t("payment_records_saving") : t("payment_records_save_record")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inp = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/20";
