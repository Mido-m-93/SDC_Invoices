"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Vendor } from "@/types";

const EMPTY_VENDOR: Omit<Vendor, "id" | "createdAt"> = {
  name: "",
  aliases: [],
  taxRegistrationNumber: "",
  bankAccountLast4: "",
  defaultReviewer: "",
  defaultProject: "",
  status: "active",
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_VENDOR, aliasesRaw: "" });
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json() as { vendors: Vendor[] };
      setVendors(data.vendors ?? []);
    } catch {
      setError("Failed to load vendors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_VENDOR, aliasesRaw: "" });
    setShowForm(true);
  }

  function openEdit(v: Vendor) {
    setEditing(v);
    setForm({ ...v, aliasesRaw: v.aliases.join("\n") });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Partial<Vendor> = {
        ...form,
        aliases: form.aliasesRaw.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      const url = editing ? `/api/vendors/${editing.id}` : "/api/vendors";
      const method = editing ? "PUT" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save vendor");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this vendor?")) return;
    await fetch(`/api/vendors/${id}`, { method: "DELETE" });
    load();
  }

  async function handleImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/admin/import-vendors", { method: "POST" });
      const data = await res.json() as { added?: number; skipped?: number; error?: string };
      if (data.error) throw new Error(data.error);
      setImportMsg(`Import complete — ${data.added ?? 0} added, ${data.skipped ?? 0} skipped`);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <PageHeader
        title="Vendor Master"
        subtitle="Registered contractors and vendors for invoice matching"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" loading={importing} onClick={handleImport}>Import from SharePoint</Button>
            <Button variant="primary" onClick={openNew}>+ Add Vendor</Button>
          </div>
        }
      />

      {importMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex justify-between">
          {importMsg}
          <button onClick={() => setImportMsg(null)} className="text-green-400 hover:text-green-600">×</button>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : vendors.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No vendors registered yet.</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>Add your first vendor</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Aliases</th>
                <th className="px-4 py-3 text-left">Tax Reg. No.</th>
                <th className="px-4 py-3 text-left">Default Reviewer</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{v.name}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{v.aliases.join(", ") || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{v.taxRegistrationNumber || "—"}</td>
                  <td className="px-4 py-3 text-stone-600">{v.defaultReviewer || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${v.status === "active" ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"}`}>
                      {v.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(v.id)}>Delete</Button>
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
              <h2 className="text-base font-semibold">{editing ? "Edit Vendor" : "Add Vendor"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Name *">
                <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Mohamad Alayoubi" />
              </Field>
              <Field label="Aliases (one per line)">
                <textarea className={`${input} h-20`} value={form.aliasesRaw} onChange={(e) => set("aliasesRaw", e.target.value)} placeholder="Alternative name spellings..." />
              </Field>
              <Field label="Tax Registration Number">
                <input className={input} value={form.taxRegistrationNumber} onChange={(e) => set("taxRegistrationNumber", e.target.value)} placeholder="T1234567890123" />
              </Field>
              <Field label="Bank Account Last 4 Digits">
                <input className={input} value={form.bankAccountLast4} onChange={(e) => set("bankAccountLast4", e.target.value)} placeholder="1234" maxLength={4} />
              </Field>
              <Field label="Default Reviewer">
                <input className={input} value={form.defaultReviewer} onChange={(e) => set("defaultReviewer", e.target.value)} placeholder="Itsuki / Tanigawa" />
              </Field>
              <Field label="Default Project">
                <input className={input} value={form.defaultProject} onChange={(e) => set("defaultProject", e.target.value)} placeholder="Project name" />
              </Field>
              <Field label="Status">
                <select className={input} value={form.status} onChange={(e) => set("status", e.target.value as "active" | "inactive")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save Vendor</Button>
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
