"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import ClientPicker from "@/components/ui/ClientPicker";
import VerificationBadge from "@/components/ui/VerificationBadge";
import type { Budget, Client, Proposal, StagedBudgetRecord } from "@/types";
import { generateId } from "@/lib/utils";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";

const STATUSES: Budget["status"][] = ["draft", "confirmed", "rejected"];

const STATUS_COLORS: Record<Budget["status"], string> = {
  draft: "bg-stone-100 text-stone-600",
  confirmed: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

type BudgetForm = Omit<Budget, "id" | "createdAt">;

const EMPTY: BudgetForm = {
  clientId: "", clientName: "", proposalId: "", projectName: "", budgetDate: "",
  budgetAmount: 0, currency: "JPY", description: "",
  status: "draft", folderUrl: "",
};

export default function BudgetPage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const statusLabel = (s: Budget["status"]) => t(`budget_status_${s}` as TranslationKey);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BudgetForm>({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ saved: number; failed: number; staged: number; savedNames: string[] } | null>(null);
  const [staged, setStaged] = useState<StagedBudgetRecord[]>([]);

  const loadStaged = useCallback(async () => {
    try {
      const res = await fetch("/api/budgets/staged");
      const data = await res.json() as { records: StagedBudgetRecord[] };
      setStaged(data.records ?? []);
    } catch {
      // Review queue is a secondary panel — a failed load here shouldn't block the page.
    }
  }, []);

  useEffect(() => { loadStaged(); }, [loadStaged]);

  async function handleSyncFromSharePoint() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/budgets/sync", { method: "POST" });
      const data = await res.json() as { saved: number; failed: number; staged: number; savedNames: string[]; error?: string };
      if (!res.ok) {
        notify("error", `SharePoint sync failed: ${data.error ?? "unknown error"}`, "/budget");
        return;
      }
      setSyncResult(data);
      notify("success", `Synced ${data.saved} budget(s) from SharePoint${data.staged > 0 ? `, ${data.staged} need client review` : ""}`, "/budget");
      load();
      loadStaged();
    } catch {
      notify("error", "SharePoint sync failed", "/budget");
    } finally {
      setSyncing(false);
    }
  }

  async function handleVerify(b: Budget) {
    setVerifying(b.id);
    try {
      const res = await fetch(`/api/budgets/${b.id}/verify`, { method: "POST" });
      if (res.ok) {
        notify("success", `Verified budget ${b.projectName}`, "/budget");
        load();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        notify("error", data.error ?? `Failed to verify budget ${b.projectName}`, "/budget");
      }
    } catch {
      notify("error", `Failed to verify budget ${b.projectName}`, "/budget");
    } finally {
      setVerifying(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, cRes, pRes] = await Promise.all([
        fetch("/api/budgets"),
        fetch("/api/clients"),
        fetch("/api/proposals"),
      ]);
      const bData = await bRes.json() as { budgets: Budget[] };
      const cData = await cRes.json() as { clients: Client[] };
      const pData = await pRes.json() as { proposals: Proposal[] };
      setBudgets(bData.budgets ?? []);
      setClients(cData.clients ?? []);
      setProposals(pData.proposals ?? []);
    } catch {
      setError(t("budget_error_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function clientName(id: string): string {
    return clients.find(c => c.id === id)?.name ?? id;
  }

  function proposalName(id?: string): string {
    if (!id) return "—";
    return proposals.find(p => p.id === id)?.projectName ?? id;
  }

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowForm(true);
  }

  function openEdit(b: Budget) {
    setEditing(b);
    setForm({
      clientId: b.clientId, clientName: b.clientName ?? "", proposalId: b.proposalId ?? "",
      projectName: b.projectName, budgetDate: b.budgetDate,
      budgetAmount: b.budgetAmount, currency: b.currency,
      description: b.description, status: b.status,
      folderUrl: b.folderUrl ?? "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/budgets/${editing.id}` : "/api/budgets";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { ...form, id: editing.id, createdAt: editing.createdAt }
        : { ...form, id: generateId("bud"), createdAt: new Date().toISOString() };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? t("budget_error_save_failed"));
        notify("error", `Failed to save budget ${form.projectName}: ${data.error ?? t("budget_error_save_failed")}`, "/budget");
        return;
      }
      setShowForm(false);
      notify("success", editing ? `Updated budget ${form.projectName}` : `Added budget ${form.projectName}`, "/budget");
      load();
    } catch {
      setError(t("budget_error_save_failed"));
      notify("error", `Failed to save budget ${form.projectName}`, "/budget");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("budget_confirm_delete"))) return;
    const target = budgets.find((b) => b.id === id);
    try {
      await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      notify("success", `Deleted budget ${target?.projectName ?? id} — restore from Archives if needed`, "/archives");
      load();
    } catch {
      setError(t("budget_error_save_failed"));
      notify("error", `Failed to delete budget ${target?.projectName ?? id}`, "/budget");
    }
  }

  const set = <K extends keyof BudgetForm>(k: K, v: BudgetForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const totalValue = budgets.filter(b => b.status === "confirmed").reduce((s, b) => s + b.budgetAmount, 0);
  const pending = budgets.filter(b => b.status === "draft").length;

  return (
    <AppShell>
      <PageHeader
        title={t("budget_title")}
        subtitle={t("budget_subtitle")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleSyncFromSharePoint} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync from SharePoint"}
            </Button>
            <Button variant="primary" onClick={openNew}>{t("budget_add_button")}</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("budget_summary_total")}</div>
          <div className="text-lg font-semibold text-stone-800">{budgets.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("budget_summary_draft")}</div>
          <div className="text-lg font-semibold text-stone-800">{pending}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("budget_summary_confirmed_value")}</div>
          <div className="text-lg font-semibold text-stone-800">¥{totalValue.toLocaleString("ja-JP")}</div>
          <div className="text-xs text-stone-400 mt-0.5">{t("budget_summary_confirmed_count").replace("{count}", String(budgets.filter(b => b.status === "confirmed").length))}</div>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 flex justify-between">
          <span>
            Synced <strong>{syncResult.saved}</strong> budget(s) from SharePoint
            {syncResult.staged > 0 && `, ${syncResult.staged} added to the review queue below (no confident client match)`}
            {syncResult.savedNames.length > 0 && `: ${syncResult.savedNames.join(", ")}`}
          </span>
          <button onClick={() => setSyncResult(null)} className="text-emerald-400 hover:text-emerald-600">×</button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200">
            <h2 className="text-sm font-semibold text-amber-800">Needs client review ({staged.length})</h2>
            <p className="text-xs text-amber-700 mt-0.5">
              These SharePoint budgets couldn&apos;t be matched to an existing client with enough confidence. Pick the right client (or leave blank to create a new one) then approve, or discard.
            </p>
          </div>
          <div className="divide-y divide-amber-200">
            {staged.map((record) => (
              <div key={record.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">{record.projectName}</p>
                  <p className="text-xs text-stone-500 truncate">
                    {record.fileName} · raw client: &ldquo;{record.rawClientName || "—"}&rdquo;
                    {record.budgetAmount ? ` · ${record.currency} ${record.budgetAmount.toLocaleString()}` : ""}
                  </p>
                </div>
                {record.fileUrl ? (
                  <a
                    href={record.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-[#1a3d2b] font-medium hover:underline"
                  >
                    Open file →
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-stone-400">No file link</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : budgets.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("budget_empty_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("budget_empty_action")}</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("budget_col_project")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_client")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_proposal")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_date")}</th>
                <th className="px-4 py-3 text-right">{t("budget_col_amount")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_verification")}</th>
                <th className="px-4 py-3 text-left">{t("budget_col_folder")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {budgets.map((b) => (
                <tr key={b.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-900">{b.projectName}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {b.clientName || (b.clientId ? clientName(b.clientId) : "—")}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{proposalName(b.proposalId)}</td>
                  <td className="px-4 py-3 text-stone-500">{b.budgetDate}</td>
                  <td className="px-4 py-3 text-right text-stone-700 font-medium">
                    {b.currency} {b.budgetAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[b.status]}`}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <VerificationBadge
                      verification={b.verificationProposal}
                      onVerify={() => handleVerify(b)}
                      verifying={verifying === b.id}
                      verifyLabel={t("budget_action_verify")}
                      reverifyLabel={t("budget_action_reverify")}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {b.folderUrl
                      ? <a href={b.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{t("budget_folder_open")}</a>
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>{t("budget_action_edit")}</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(b.id)}>{t("budget_action_delete")}</Button>
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
              <h2 className="text-base font-semibold">{editing ? t("budget_modal_edit_title") : t("budget_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("budget_field_project_name")}>
                <input className={input} value={form.projectName} onChange={e => set("projectName", e.target.value)} placeholder={t("budget_field_project_name_placeholder")} />
              </Field>
              <Field label={t("budget_field_client")}>
                <ClientPicker
                  clients={clients}
                  clientId={form.clientId}
                  clientName={form.clientName ?? ""}
                  onChange={(clientId, clientName) => setForm(f => ({ ...f, clientId, clientName }))}
                  onClientCreated={(c) => setClients(cs => [...cs, c])}
                  className={input}
                />
              </Field>
              <Field label={t("budget_field_proposal")}>
                <select
                  className={input}
                  value={form.proposalId ?? ""}
                  onChange={e => set("proposalId", e.target.value)}
                >
                  <option value="">{t("budget_field_proposal_placeholder")}</option>
                  {proposals
                    .filter(p => !form.clientId || p.clientId === form.clientId)
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.projectName}</option>
                    ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("budget_field_date")}>
                  <input type="date" className={input} value={form.budgetDate} onChange={e => set("budgetDate", e.target.value)} />
                </Field>
                <Field label={t("budget_field_currency")}>
                  <select className={input} value={form.currency} onChange={e => set("currency", e.target.value)}>
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
              <Field label={t("budget_field_amount")}>
                <input type="number" className={input} value={form.budgetAmount || ""} onChange={e => set("budgetAmount", Number(e.target.value))} placeholder="0" />
              </Field>
              <Field label={t("budget_field_description")}>
                <textarea className={`${input} h-20 resize-none`} value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("budget_field_description_placeholder")} />
              </Field>
              <Field label={t("budget_field_status")}>
                <select className={input} value={form.status} onChange={e => set("status", e.target.value as Budget["status"])}>
                  {STATUSES.map((v) => (
                    <option key={v} value={v}>{statusLabel(v)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("budget_field_folder_url")}>
                <input className={input} value={form.folderUrl ?? ""} onChange={e => set("folderUrl", e.target.value)} placeholder="https://drive.google.com/..." />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("budget_action_save")}</Button>
            </div>
          </div>
        </div>
      )}
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
