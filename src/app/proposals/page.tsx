"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import type { Proposal } from "@/types";
import { generateId } from "@/lib/utils";

const STATUS_LABELS: Record<Proposal["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

const STATUS_COLORS: Record<Proposal["status"], string> = {
  draft: "bg-stone-100 text-stone-600",
  submitted: "bg-blue-50 text-blue-700",
  accepted: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-amber-50 text-amber-700",
};

const EMPTY: Omit<Proposal, "id" | "createdAt"> = {
  vendorId: "",
  projectName: "",
  proposalDate: "",
  estimatedAmount: 0,
  currency: "JPY",
  description: "",
  status: "draft",
  contractId: "",
  folderUrl: "",
};

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proposals");
      const data = await res.json() as { proposals: Proposal[] };
      setProposals(data.proposals ?? []);
    } catch {
      setError("Failed to load proposals");
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

  function openEdit(p: Proposal) {
    setEditing(p);
    setForm({ vendorId: p.vendorId, projectName: p.projectName, proposalDate: p.proposalDate, estimatedAmount: p.estimatedAmount, currency: p.currency, description: p.description, status: p.status, contractId: p.contractId ?? "", folderUrl: p.folderUrl ?? "" });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/proposals/${editing.id}` : "/api/proposals";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { ...form, id: editing.id, createdAt: editing.createdAt }
        : { ...form, id: generateId("prop"), createdAt: new Date().toISOString() };
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save proposal");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this proposal?")) return;
    await fetch(`/api/proposals/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Proposals</h1>
            <p className="text-sm text-stone-500 mt-0.5">Track proposals and link them to contracts — the first step in the document chain</p>
          </div>
          <button onClick={openNew} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium hover:bg-[#14301f] transition">
            + Add Proposal
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
        ) : proposals.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
            <p className="text-stone-400 text-sm">No proposals yet.</p>
            <button onClick={openNew} className="mt-4 px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium">Add first proposal</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Project</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Contract ID</th>
                  <th className="px-4 py-3 text-left">Folder</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {proposals.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{p.projectName}</td>
                    <td className="px-4 py-3 text-stone-600">{p.vendorId}</td>
                    <td className="px-4 py-3 text-stone-500">{p.proposalDate}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{p.currency} {p.estimatedAmount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-500 font-mono text-xs">{p.contractId || "—"}</td>
                    <td className="px-4 py-3">
                      {p.folderUrl ? (
                        <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">Open</a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(p)} className="text-xs text-stone-500 hover:text-stone-800">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
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
                <h2 className="text-base font-semibold">{editing ? "Edit Proposal" : "Add Proposal"}</h2>
                <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <Field label="Project Name"><input className={input} value={form.projectName} onChange={e => set("projectName", e.target.value)} /></Field>
                <Field label="Vendor ID"><input className={input} value={form.vendorId} onChange={e => set("vendorId", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Proposal Date"><input type="date" className={input} value={form.proposalDate} onChange={e => set("proposalDate", e.target.value)} /></Field>
                  <Field label="Currency"><select className={input} value={form.currency} onChange={e => set("currency", e.target.value)}><option>JPY</option><option>USD</option><option>EUR</option></select></Field>
                </div>
                <Field label="Estimated Amount"><input type="number" className={input} value={form.estimatedAmount} onChange={e => set("estimatedAmount", Number(e.target.value))} /></Field>
                <Field label="Description"><textarea className={`${input} h-20 resize-none`} value={form.description} onChange={e => set("description", e.target.value)} /></Field>
                <Field label="Status">
                  <select className={input} value={form.status} onChange={e => set("status", e.target.value as Proposal["status"])}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Linked Contract ID (optional)"><input className={input} value={form.contractId} onChange={e => set("contractId", e.target.value)} placeholder="contract id when accepted" /></Field>
                <Field label="Contract Folder URL (optional)"><input className={input} value={form.folderUrl} onChange={e => set("folderUrl", e.target.value)} placeholder="https://drive.google.com/..." /></Field>
              </div>
              <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? "Saving…" : "Save Proposal"}
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

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/20";
