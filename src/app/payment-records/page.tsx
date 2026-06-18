"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import type { PaymentRecord, PaymentRecordStatus } from "@/types";
import { generateId } from "@/lib/utils";

const STATUS_LABELS: Record<PaymentRecordStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  reconciled: "Reconciled",
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
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<PaymentRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payment-records");
      const data = await res.json() as { records: PaymentRecord[] };
      setRecords(data.records ?? []);
    } catch {
      setError("Failed to load payment records");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError("Failed to save payment record");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this payment record?")) return;
    await fetch(`/api/payment-records/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Payment Records</h1>
            <p className="text-sm text-stone-500 mt-0.5">Link payments to invoices and contracts — completing the document chain</p>
          </div>
          <button onClick={openNew} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium hover:bg-[#14301f] transition">
            + Add Payment
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : records.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
            <p className="text-stone-400 text-sm">No payment records yet.</p>
            <button onClick={openNew} className="mt-4 px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium">Add first payment record</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Invoice ID</th>
                  <th className="px-4 py-3 text-left">Contract ID</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Method</th>
                  <th className="px-4 py-3 text-left">Ref #</th>
                  <th className="px-4 py-3 text-left">Status</th>
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
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">{r.referenceNumber || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(r)} className="text-xs text-stone-500 hover:text-stone-800">Edit</button>
                        <button onClick={() => handleDelete(r.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
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
                <h2 className="text-base font-semibold">{editing ? "Edit Payment Record" : "Add Payment Record"}</h2>
                <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <Field label="Invoice ID"><input className={inp} value={form.invoiceId} onChange={e => set("invoiceId", e.target.value)} /></Field>
                <Field label="Contract ID"><input className={inp} value={form.contractId} onChange={e => set("contractId", e.target.value)} /></Field>
                <Field label="Vendor ID"><input className={inp} value={form.vendorId} onChange={e => set("vendorId", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Amount"><input type="number" className={inp} value={form.amount} onChange={e => set("amount", Number(e.target.value))} /></Field>
                  <Field label="Currency"><select className={inp} value={form.currency} onChange={e => set("currency", e.target.value)}><option>JPY</option><option>USD</option><option>EUR</option></select></Field>
                </div>
                <Field label="Payment Date"><input type="date" className={inp} value={form.paymentDate} onChange={e => set("paymentDate", e.target.value)} /></Field>
                <Field label="Payment Method"><input className={inp} value={form.paymentMethod} onChange={e => set("paymentMethod", e.target.value)} placeholder="Bank transfer, credit card…" /></Field>
                <Field label="Reference Number"><input className={inp} value={form.referenceNumber} onChange={e => set("referenceNumber", e.target.value)} /></Field>
                <Field label="Status">
                  <select className={inp} value={form.status} onChange={e => set("status", e.target.value as PaymentRecordStatus)}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Confirmed By"><input className={inp} value={form.confirmedBy} onChange={e => set("confirmedBy", e.target.value)} /></Field>
                <Field label="Notes"><textarea className={`${inp} h-16 resize-none`} value={form.notes} onChange={e => set("notes", e.target.value)} /></Field>
              </div>
              <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? "Saving…" : "Save Record"}
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
