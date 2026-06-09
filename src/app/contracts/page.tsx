"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Contract, Vendor } from "@/types";

const EMPTY_CONTRACT: Omit<Contract, "id" | "createdAt"> = {
  vendorId: "",
  projectName: "",
  startDate: "",
  endDate: "",
  expectedMonthlyAmount: 0,
  currency: "JPY",
  paymentTerms: "",
  status: "active",
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_CONTRACT });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, vRes] = await Promise.all([
        fetch("/api/contracts"),
        fetch("/api/vendors"),
      ]);
      const cData = await cRes.json() as { contracts: Contract[] };
      const vData = await vRes.json() as { vendors: Vendor[] };
      setContracts(cData.contracts ?? []);
      setVendors(vData.vendors ?? []);
    } catch {
      setError("Failed to load contracts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_CONTRACT });
    setShowForm(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({ ...c });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/contracts/${editing.id}` : "/api/contracts";
      const method = editing ? "PUT" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save contract");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contract?")) return;
    await fetch(`/api/contracts/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;

  return (
    <AppShell>
      <PageHeader
        title="Contract Master"
        subtitle="Active contracts used for invoice amount and period validation"
        actions={<Button variant="primary" onClick={openNew}>+ Add Contract</Button>}
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : contracts.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No contracts registered yet.</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>Add your first contract</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Vendor</th>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-left">Monthly Amount</th>
                <th className="px-4 py-3 text-left">Payment Terms</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{vendorName(c.vendorId)}</td>
                  <td className="px-4 py-3 text-stone-600">{c.projectName || "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 font-mono">{c.startDate} → {c.endDate}</td>
                  <td className="px-4 py-3 text-stone-700">
                    {c.expectedMonthlyAmount > 0
                      ? `¥${c.expectedMonthlyAmount.toLocaleString("ja-JP")}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{c.paymentTerms || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === "active" ? "bg-green-100 text-green-700" :
                      c.status === "expired" ? "bg-stone-100 text-stone-500" :
                      "bg-red-100 text-red-600"
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? "Edit Contract" : "Add Contract"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Vendor *">
                <select className={input} value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
                  <option value="">— Select vendor —</option>
                  {vendors.filter((v) => v.status === "active").map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Project Name">
                <input className={input} value={form.projectName} onChange={(e) => set("projectName", e.target.value)} placeholder="Project or engagement name" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Start Date *">
                  <input type="date" className={input} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
                </Field>
                <Field label="End Date *">
                  <input type="date" className={input} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
                </Field>
              </div>
              <Field label="Expected Monthly Amount (¥)">
                <input type="number" className={input} value={form.expectedMonthlyAmount || ""} onChange={(e) => set("expectedMonthlyAmount", Number(e.target.value))} placeholder="330000" />
              </Field>
              <Field label="Currency">
                <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                  <option value="JPY">JPY — Japanese Yen</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="EUR">EUR — Euro</option>
                </select>
              </Field>
              <Field label="Payment Terms">
                <input className={input} value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="月末締め翌月末払い" />
              </Field>
              <Field label="Status">
                <select className={input} value={form.status} onChange={(e) => set("status", e.target.value as Contract["status"])}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save Contract</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
