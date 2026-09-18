"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import RefreshIcon from "@/components/ui/RefreshIcon";
import ClientPicker from "@/components/ui/ClientPicker";
import VerificationBadge from "@/components/ui/VerificationBadge";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { Budget, Client, Proposal } from "@/types";
import { generateId } from "@/lib/utils";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";

const STATUSES: Budget["status"][] = ["draft", "confirmed", "rejected"];

const STATUS_TONES: Record<Budget["status"], BadgeTone> = {
  draft: "neutral",
  confirmed: "success",
  rejected: "danger",
};

interface SharePointBudgetFile {
  fileName: string;
  fileUrl: string | null;
  folder: string;
  size: number | null;
}

// Scan results aren't saved to the database, so without this they'd vanish
// on every navigation away from the page — persist per-tab in sessionStorage.
const SHAREPOINT_FILES_KEY = "budget_sharepoint_files";

function loadStoredSharePointFiles(): SharePointBudgetFile[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SHAREPOINT_FILES_KEY);
    return raw ? (JSON.parse(raw) as SharePointBudgetFile[]) : null;
  } catch {
    return null;
  }
}

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
  const [sharepointFiles, setSharepointFiles] = useState<SharePointBudgetFile[] | null>(loadStoredSharePointFiles);
  const [search, setSearch] = useState("");
  const [viewingFiles, setViewingFiles] = useState<Budget | null>(null);
  const [linkCandidates, setLinkCandidates] = useState<{ name: string; webUrl: string; score: number }[] | null>(null);
  const [linkCandidatesError, setLinkCandidatesError] = useState<string | null>(null);
  const [loadingLinkCandidates, setLoadingLinkCandidates] = useState(false);
  const [linkingFile, setLinkingFile] = useState<string | null>(null);

  // Read-only: scans SharePoint for budget-looking files and shows what's
  // there. No matching, no approval — just sync (rescan) and display, same
  // pattern as the Members contract folder browser.
  async function handleSyncFromSharePoint() {
    setSyncing(true);
    try {
      const res = await fetch("/api/budgets/sync", { method: "POST" });
      const data = await res.json() as { files?: SharePointBudgetFile[]; error?: string };
      if (!res.ok) {
        notify("error", `SharePoint sync failed: ${data.error ?? "unknown error"}`, "/budget");
        return;
      }
      setSharepointFiles(data.files ?? []);
      notify("success", `Found ${data.files?.length ?? 0} budget file(s) in SharePoint`, "/budget");
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

  useEffect(() => {
    try {
      if (sharepointFiles === null) sessionStorage.removeItem(SHAREPOINT_FILES_KEY);
      else sessionStorage.setItem(SHAREPOINT_FILES_KEY, JSON.stringify(sharepointFiles));
    } catch {
      // sessionStorage unavailable (private mode, etc.) — non-fatal
    }
  }, [sharepointFiles]);

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

  async function handleViewLinkCandidates(b: Budget) {
    setViewingFiles(b);
    setLinkCandidates(null);
    setLinkCandidatesError(null);
    setLoadingLinkCandidates(true);
    try {
      const res = await fetch(`/api/budgets/${b.id}/folder-files`);
      const data = await res.json() as { files?: typeof linkCandidates; error?: string };
      if (!res.ok) {
        setLinkCandidatesError(data.error ?? "Failed to load SharePoint files");
        return;
      }
      setLinkCandidates(data.files ?? []);
    } catch {
      setLinkCandidatesError("Failed to load SharePoint files");
    } finally {
      setLoadingLinkCandidates(false);
    }
  }

  async function handleUseAsFolderLink(webUrl: string) {
    if (!viewingFiles) return;
    setLinkingFile(webUrl);
    try {
      const res = await fetch(`/api/budgets/${viewingFiles.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...viewingFiles, folderUrl: webUrl }),
      });
      if (!res.ok) throw new Error();
      notify("success", `Linked file to budget ${viewingFiles.projectName}`, "/budget");
      setViewingFiles(null);
      load();
    } catch {
      notify("error", "Failed to link file to budget", "/budget");
    } finally {
      setLinkingFile(null);
    }
  }

  const set = <K extends keyof BudgetForm>(k: K, v: BudgetForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const filteredBudgets = (() => {
    const query = search.trim().toLowerCase();
    if (!query) return budgets;
    return budgets.filter((b) =>
      [b.projectName, b.clientName || (b.clientId ? clientName(b.clientId) : ""), proposalName(b.proposalId)]
        .some((field) => field?.toLowerCase().includes(query))
    );
  })();

  return (
    <AppShell>
      <PageHeader
        title={t("budget_title")}
        subtitle={t("budget_subtitle")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleSyncFromSharePoint} loading={syncing} icon={<RefreshIcon />}>
              {t("budget_sync_button")}
            </Button>
            <Button variant="primary" onClick={openNew}>{t("budget_add_button")}</Button>
          </div>
        }
      />

      {budgets.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <input
            className={`${input} max-w-xs`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, client, proposal…"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-stone-400 hover:text-stone-600">
              Clear
            </button>
          )}
          <span className="text-xs text-stone-400">
            {filteredBudgets.length} / {budgets.length} shown
          </span>
        </div>
      )}

      {sharepointFiles !== null && (
        <div className="mb-5 bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-800">SharePoint budget files ({sharepointFiles.length})</h2>
            <button onClick={() => setSharepointFiles(null)} className="text-stone-400 hover:text-stone-600 text-sm">×</button>
          </div>
          {sharepointFiles.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-400">No budget files found in SharePoint.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {sharepointFiles.map((f) => (
                <li key={`${f.folder}/${f.fileName}`} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    {f.fileUrl ? (
                      <a href={f.fileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block">
                        📄 {f.fileName}
                      </a>
                    ) : (
                      <span className="text-stone-700 truncate block">📄 {f.fileName}</span>
                    )}
                    <span className="text-xs text-stone-400">{f.folder}</span>
                  </div>
                  {f.size != null && (
                    <span className="text-xs text-stone-400 shrink-0">{Math.round(f.size / 1024)} KB</span>
                  )}
                  <button
                    onClick={() => setSharepointFiles((files) => (files ?? []).filter((x) => x !== f))}
                    className="text-stone-400 hover:text-red-600 text-xs shrink-0"
                    title="Remove from this list"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
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
      ) : filteredBudgets.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No budgets match your search.</p>
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
              {filteredBudgets.map((b) => (
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
                    <Badge tone={STATUS_TONES[b.status]}>
                      {statusLabel(b.status)}
                    </Badge>
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
                    {b.folderUrl ? (
                      <a href={b.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{t("budget_folder_open")}</a>
                    ) : (
                      <button onClick={() => handleViewLinkCandidates(b)} className="text-xs text-blue-600 hover:underline">
                        Find file
                      </button>
                    )}
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

      {viewingFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]" onClick={() => setViewingFiles(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{viewingFiles.projectName}</h2>
              <button onClick={() => setViewingFiles(null)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5">
              <p className="mb-3 text-xs text-stone-400">
                SharePoint files ranked by how closely their name matches this budget — pick the right one, nothing is linked automatically.
              </p>
              {loadingLinkCandidates && <p className="text-sm text-stone-500">Loading…</p>}
              {linkCandidatesError && <p className="text-sm text-red-600">{linkCandidatesError}</p>}
              {linkCandidates && linkCandidates.length === 0 && (
                <p className="text-sm text-stone-500">No similarly-named files found in SharePoint.</p>
              )}
              {linkCandidates && linkCandidates.length > 0 && (
                <ul className="divide-y divide-stone-100">
                  {linkCandidates.map((f) => (
                    <li key={f.webUrl} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <a href={f.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                          📄 {f.name}
                        </a>
                        <span className="text-xs text-stone-400">{Math.round(f.score * 100)}% name match</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={linkingFile === f.webUrl}
                        onClick={() => handleUseAsFolderLink(f.webUrl)}
                      >
                        Use as folder link
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
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
