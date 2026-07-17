"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import type { Proposal } from "@/types";
import { generateId } from "@/lib/utils";
import { useLanguage } from "@/translations";

const STATUS_KEYS: Record<Proposal["status"], "proposals_status_draft" | "proposals_status_submitted" | "proposals_status_accepted" | "proposals_status_rejected" | "proposals_status_expired"> = {
  draft: "proposals_status_draft",
  submitted: "proposals_status_submitted",
  accepted: "proposals_status_accepted",
  rejected: "proposals_status_rejected",
  expired: "proposals_status_expired",
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
  const { t } = useLanguage();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proposals");
      const data = await res.json() as { proposals: Proposal[] };
      setProposals(data.proposals ?? []);
    } catch {
      setError(t("proposals_load_error"));
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
      setError(t("proposals_save_error"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("proposals_delete_confirm"))) return;
    await fetch(`/api/proposals/${id}`, { method: "DELETE" });
    load();
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    setDeletingSelected(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => fetch(`/api/proposals/${id}`, { method: "DELETE" })));
      setProposals((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
    } catch (e) { setError(String(e)); }
    finally { setDeletingSelected(false); }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{t("proposals_title")}</h1>
            <p className="text-sm text-stone-500 mt-0.5">{t("proposals_subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deletingSelected ? t("proposals_deleting") : `${t("proposals_delete_selected")} (${selectedIds.size})`}
              </button>
            )}
            <button onClick={openNew} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium hover:bg-[#14301f] transition">
              {t("proposals_add")}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-stone-400">{t("loading")}</p>
        ) : proposals.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
            <p className="text-stone-400 text-sm">{t("proposals_empty")}</p>
            <button onClick={openNew} className="mt-4 px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium">{t("proposals_add_first")}</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox"
                      checked={proposals.length > 0 && proposals.every((p) => selectedIds.has(p.id))}
                      onChange={(e) => setSelectedIds(() => {
                        const next = new Set<string>();
                        if (e.target.checked) proposals.forEach((p) => next.add(p.id));
                        return next;
                      })} />
                  </th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_project")}</th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_vendor")}</th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_date")}</th>
                  <th className="px-4 py-3 text-right">{t("proposals_col_amount")}</th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_status")}</th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_contract_id")}</th>
                  <th className="px-4 py-3 text-left">{t("proposals_col_folder")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {proposals.map((p) => (
                  <tr key={p.id} className={selectedIds.has(p.id) ? "bg-red-50/40" : "hover:bg-stone-50"}>
                    <td className="w-10 px-3 py-3">
                      <input type="checkbox" checked={selectedIds.has(p.id)}
                        onChange={(e) => setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id); else next.delete(p.id);
                          return next;
                        })} />
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-900">{p.projectName}</td>
                    <td className="px-4 py-3 text-stone-600">{p.vendorId}</td>
                    <td className="px-4 py-3 text-stone-500">{p.proposalDate}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{p.currency} {p.estimatedAmount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
                        {t(STATUS_KEYS[p.status])}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-500 font-mono text-xs">{p.contractId || "—"}</td>
                    <td className="px-4 py-3">
                      {p.folderUrl ? (
                        <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{t("proposals_folder_open")}</a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(p)} className="text-xs text-stone-500 hover:text-stone-800">{t("proposals_edit_action")}</button>
                        <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-600">{t("proposals_delete_action")}</button>
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
                <h2 className="text-base font-semibold">{editing ? t("proposals_modal_edit_title") : t("proposals_modal_add_title")}</h2>
                <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <Field label={t("proposals_field_project_name")}><input className={input} value={form.projectName} onChange={e => set("projectName", e.target.value)} /></Field>
                <Field label={t("proposals_field_vendor_id")}><input className={input} value={form.vendorId} onChange={e => set("vendorId", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("proposals_field_proposal_date")}><input type="date" className={input} value={form.proposalDate} onChange={e => set("proposalDate", e.target.value)} /></Field>
                  <Field label={t("proposals_field_currency")}><select className={input} value={form.currency} onChange={e => set("currency", e.target.value)}><option>JPY</option><option>USD</option><option>EUR</option></select></Field>
                </div>
                <Field label={t("proposals_field_estimated_amount")}><input type="number" className={input} value={form.estimatedAmount} onChange={e => set("estimatedAmount", Number(e.target.value))} /></Field>
                <Field label={t("proposals_field_description")}><textarea className={`${input} h-20 resize-none`} value={form.description} onChange={e => set("description", e.target.value)} /></Field>
                <Field label={t("proposals_field_status")}>
                  <select className={input} value={form.status} onChange={e => set("status", e.target.value as Proposal["status"])}>
                    {Object.entries(STATUS_KEYS).map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
                  </select>
                </Field>
                <Field label={t("proposals_field_contract_id_optional")}><input className={input} value={form.contractId} onChange={e => set("contractId", e.target.value)} placeholder={t("proposals_placeholder_contract_id")} /></Field>
                <Field label={t("proposals_field_folder_url_optional")}><input className={input} value={form.folderUrl} onChange={e => set("folderUrl", e.target.value)} placeholder={t("proposals_placeholder_folder_url")} /></Field>
              </div>
              <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">{t("cancel")}</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[#1a3d2b] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? t("proposals_saving") : t("proposals_save_button")}
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
