"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Client } from "@/types";
import { generateId } from "@/lib/utils";

const EMPTY_CLIENT: Omit<Client, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  legalName: "",
  industry: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  country: "JP",
  taxRegistrationNumber: "",
  status: "prospect",
  notes: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients");
      const data = await res.json() as { clients: Client[] };
      setClients(data.clients ?? []);
    } catch {
      setError("Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_CLIENT });
    setShowForm(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ ...c });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/clients/${editing.id}` : "/api/clients";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { ...form }
        : { ...form, id: generateId("cli"), createdAt: new Date().toISOString() };
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save client");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this client?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        subtitle="Companies that receive proposals, contracts, and invoices"
        actions={
          <Button variant="primary" onClick={openNew}>
            + Add Client
          </Button>
        }
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : clients.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No clients registered yet.</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>Add your first client</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Company Name</th>
                <th className="px-4 py-3 text-left">Industry</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{c.name}</td>
                  <td className="px-4 py-3 text-stone-600">{c.industry || "—"}</td>
                  <td className="px-4 py-3 text-stone-600">{c.contactName || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{c.contactEmail || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === "active"   ? "bg-green-100 text-green-700" :
                      c.status === "inactive" ? "bg-stone-100 text-stone-500" :
                      "bg-blue-100 text-blue-700"
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
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? "Edit Client" : "Add Client"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Company Name *">
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Acme Corporation"
                />
              </Field>
              <Field label="Legal Name">
                <input
                  className={input}
                  value={form.legalName}
                  onChange={(e) => set("legalName", e.target.value)}
                  placeholder="Acme Corporation K.K."
                />
              </Field>
              <Field label="Industry">
                <input
                  className={input}
                  value={form.industry}
                  onChange={(e) => set("industry", e.target.value)}
                  placeholder="Technology, Finance, Healthcare…"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contact Name">
                  <input
                    className={input}
                    value={form.contactName}
                    onChange={(e) => set("contactName", e.target.value)}
                    placeholder="Taro Yamada"
                  />
                </Field>
                <Field label="Contact Email">
                  <input
                    type="email"
                    className={input}
                    value={form.contactEmail}
                    onChange={(e) => set("contactEmail", e.target.value)}
                    placeholder="taro@example.com"
                  />
                </Field>
              </div>
              <Field label="Contact Phone">
                <input
                  className={input}
                  value={form.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  placeholder="+81-3-0000-0000"
                />
              </Field>
              <Field label="Address">
                <input
                  className={input}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="1-1-1 Marunouchi, Chiyoda-ku, Tokyo"
                />
              </Field>
              <Field label="Country">
                <input
                  className={input}
                  value={form.country}
                  onChange={(e) => set("country", e.target.value)}
                  placeholder="JP"
                />
              </Field>
              <Field label="Tax Registration Number">
                <input
                  className={input}
                  value={form.taxRegistrationNumber}
                  onChange={(e) => set("taxRegistrationNumber", e.target.value)}
                  placeholder="T1234567890123"
                />
              </Field>
              <Field label="Status">
                <select
                  className={input}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as Client["status"])}
                >
                  <option value="prospect">Prospect</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea
                  className={`${input} resize-none`}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Additional notes…"
                />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={handleSave}
                className="bg-[#1a3d2b] hover:bg-[#14321f]"
              >
                Save Client
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const input =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
