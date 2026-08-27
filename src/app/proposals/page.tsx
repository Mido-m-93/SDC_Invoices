"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import ClientPicker from "@/components/ui/ClientPicker";
import VerificationBadge from "@/components/ui/VerificationBadge";
import type { Proposal, Client, Lead, StagedProposalRecord } from "@/types";
import { generateId } from "@/lib/utils";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";

const STATUSES: Proposal["status"][] = ["draft", "submitted", "accepted", "rejected", "expired"];

interface AcceptedResult {
  proposal: Proposal;
  contract: { id: string; projectName: string };
  leadsAdvanced: number;
  clientEmail?: string;
}

const STATUS_COLORS: Record<Proposal["status"], string> = {
  draft: "bg-stone-100 text-stone-600",
  submitted: "bg-blue-50 text-blue-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-amber-50 text-amber-700",
};

type ProposalForm = Omit<Proposal, "id" | "createdAt">;

const EMPTY: ProposalForm = {
  clientId: "", clientName: "", leadId: "", projectName: "", proposalDate: "",
  estimatedAmount: 0, currency: "JPY", description: "",
  status: "draft", contractId: "", folderUrl: "",
};

export default function ProposalsPage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const statusLabel = (s: Proposal["status"]) => t(`proposals_status_${s}` as TranslationKey);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProposalForm>({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptedResult, setAcceptedResult] = useState<AcceptedResult | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ saved: number; failed: number; staged: number; savedNames: string[] } | null>(null);
  const [staged, setStaged] = useState<StagedProposalRecord[]>([]);
  const [stagedPicks, setStagedPicks] = useState<Record<string, { clientId: string; clientName: string }>>({});
  const [resolvingStaged, setResolvingStaged] = useState<string | null>(null);

  const loadStaged = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals/staged");
      const data = await res.json() as { records: StagedProposalRecord[] };
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
      const res = await fetch("/api/proposals/sync", { method: "POST" });
      const data = await res.json() as { saved: number; failed: number; staged: number; savedNames: string[]; error?: string };
      if (!res.ok) {
        notify("error", `SharePoint sync failed: ${data.error ?? "unknown error"}`, "/proposals");
        return;
      }
      setSyncResult(data);
      notify("success", `Synced ${data.saved} proposal(s) from SharePoint${data.staged > 0 ? `, ${data.staged} need client review` : ""}`, "/proposals");
      load();
      loadStaged();
    } catch {
      notify("error", "SharePoint sync failed", "/proposals");
    } finally {
      setSyncing(false);
    }
  }

  function pickForStaged(id: string, clientId: string, clientName: string) {
    setStagedPicks((p) => ({ ...p, [id]: { clientId, clientName } }));
  }

  async function handleApproveStaged(record: StagedProposalRecord) {
    const pick = stagedPicks[record.id];
    setResolvingStaged(record.id);
    try {
      const res = await fetch(`/api/proposals/staged/${record.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: pick?.clientId || undefined }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        notify("error", `Failed to approve "${record.projectName}": ${data.error ?? "unknown error"}`, "/proposals");
        return;
      }
      notify("success", `Added proposal "${record.projectName}"`, "/proposals");
      setStaged((s) => s.filter((r) => r.id !== record.id));
      load();
    } catch {
      notify("error", `Failed to approve "${record.projectName}"`, "/proposals");
    } finally {
      setResolvingStaged(null);
    }
  }

  async function handleRejectStaged(record: StagedProposalRecord) {
    setResolvingStaged(record.id);
    try {
      const res = await fetch(`/api/proposals/staged/${record.id}/reject`, { method: "POST" });
      if (!res.ok) {
        notify("error", `Failed to discard "${record.projectName}"`, "/proposals");
        return;
      }
      setStaged((s) => s.filter((r) => r.id !== record.id));
    } catch {
      notify("error", `Failed to discard "${record.projectName}"`, "/proposals");
    } finally {
      setResolvingStaged(null);
    }
  }

  async function handleVerify(p: Proposal) {
    setVerifying(p.id);
    try {
      const res = await fetch(`/api/proposals/${p.id}/verify`, { method: "POST" });
      if (res.ok) {
        notify("success", `Verified proposal ${p.projectName}`, "/proposals");
        load();
      } else {
        notify("error", `Failed to verify proposal ${p.projectName}`, "/proposals");
      }
    } catch {
      notify("error", `Failed to verify proposal ${p.projectName}`, "/proposals");
    } finally {
      setVerifying(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, lRes] = await Promise.all([
        fetch("/api/proposals"),
        fetch("/api/clients"),
        fetch("/api/leads"),
      ]);
      const pData = await pRes.json() as { proposals: Proposal[] };
      const cData = await cRes.json() as { clients: Client[] };
      const lData = await lRes.json() as { leads: Lead[] };
      setProposals(pData.proposals ?? []);
      setClients(cData.clients ?? []);
      setLeads(lData.leads ?? []);
    } catch {
      setError(t("proposals_error_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function clientName(id: string): string {
    return clients.find(c => c.id === id)?.name ?? id;
  }

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowForm(true);
  }

  function openEdit(p: Proposal) {
    setEditing(p);
    setForm({
      clientId: p.clientId, clientName: p.clientName ?? "", leadId: p.leadId ?? "",
      projectName: p.projectName, proposalDate: p.proposalDate,
      estimatedAmount: p.estimatedAmount, currency: p.currency,
      description: p.description, status: p.status,
      contractId: p.contractId ?? "", folderUrl: p.folderUrl ?? "",
    });
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
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? t("proposals_error_save_failed"));
        notify("error", `Failed to save proposal ${form.projectName}: ${data.error ?? t("proposals_error_save_failed")}`, "/proposals");
        return;
      }
      setShowForm(false);
      notify("success", editing ? `Updated proposal ${form.projectName}` : `Added proposal ${form.projectName}`, "/proposals");
      load();
    } catch {
      setError(t("proposals_error_save_failed"));
      notify("error", `Failed to save proposal ${form.projectName}`, "/proposals");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("proposals_confirm_delete"))) return;
    const target = proposals.find((p) => p.id === id);
    try {
      await fetch(`/api/proposals/${id}`, { method: "DELETE" });
      notify("success", `Deleted proposal ${target?.projectName ?? id}`, "/proposals");
      load();
    } catch {
      setError(t("proposals_error_save_failed"));
      notify("error", `Failed to delete proposal ${target?.projectName ?? id}`, "/proposals");
    }
  }

  async function handleAccept(p: Proposal, override = false) {
    if (!override && !confirm(t("proposals_confirm_accept").replace("{project}", p.projectName))) return;
    setAccepting(p.id);
    try {
      const res = await fetch(`/api/proposals/${p.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override }),
      });
      const data = await res.json() as { success: boolean; proposal: Proposal; contract: { id: string; projectName: string }; leadsAdvanced: number; error?: string; discrepancies?: string[]; requiresOverride?: boolean };
      if (!res.ok) {
        if (data.requiresOverride) {
          const list = (data.discrepancies ?? []).map(d => `• ${d}`).join("\n");
          if (confirm(`${t("proposals_verification_mismatch")}\n\n${list}\n\n${t("proposals_verification_override_confirm")}`)) {
            await handleAccept(p, true);
          }
          return;
        }
        setError(t("proposals_error_accept_failed").replace("{error}", data.error ?? t("proposals_error_unknown")));
        notify("error", `Failed to accept proposal ${p.projectName}: ${data.error ?? t("proposals_error_unknown")}`, "/proposals");
        return;
      }
      const client = clients.find(c => c.id === p.clientId);
      setAcceptedResult({
        proposal: data.proposal,
        contract: data.contract,
        leadsAdvanced: data.leadsAdvanced,
        clientEmail: client?.contactEmail,
      });
      notify("success", `Accepted proposal ${p.projectName}, contract ${data.contract.id} created`, "/proposals");
      load();
    } catch {
      setError(t("proposals_error_accept_generic"));
      notify("error", `Failed to accept proposal ${p.projectName}`, "/proposals");
    } finally {
      setAccepting(null);
    }
  }

  function openOutlookCompose(result: AcceptedResult) {
    const to = result.clientEmail ?? "";
    const subject = encodeURIComponent(t("proposals_email_subject").replace("{project}", result.proposal.projectName));
    const body = encodeURIComponent(
      t("proposals_email_greeting").replace("{client}", result.proposal.clientName ?? t("proposals_email_client_fallback")) +
      t("proposals_email_intro").replace("{project}", result.proposal.projectName) +
      t("proposals_email_project_label").replace("{project}", result.proposal.projectName) +
      t("proposals_email_amount_label").replace("{amount}", `${result.proposal.currency} ${result.proposal.estimatedAmount.toLocaleString()}`) +
      t("proposals_email_contract_label").replace("{contract}", result.contract.id) +
      t("proposals_email_next_steps") +
      t("proposals_email_signoff")
    );
    window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${subject}&body=${body}`, "_blank");
  }

  const set = <K extends keyof ProposalForm>(k: K, v: ProposalForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const totalValue = proposals.filter(p => p.status === "accepted").reduce((s, p) => s + p.estimatedAmount, 0);
  const pending = proposals.filter(p => ["draft", "submitted"].includes(p.status)).length;

  return (
    <AppShell>
      <PageHeader
        title={t("proposals_title")}
        subtitle={t("proposals_subtitle")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleSyncFromSharePoint} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync from SharePoint"}
            </Button>
            <Button variant="primary" onClick={openNew}>{t("proposals_add_button")}</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("proposals_summary_total")}</div>
          <div className="text-lg font-semibold text-stone-800">{proposals.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("proposals_summary_pending")}</div>
          <div className="text-lg font-semibold text-stone-800">{pending}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">{t("proposals_summary_won_value")}</div>
          <div className="text-lg font-semibold text-stone-800">¥{totalValue.toLocaleString("ja-JP")}</div>
          <div className="text-xs text-stone-400 mt-0.5">{t("proposals_summary_accepted_count").replace("{count}", String(proposals.filter(p => p.status === "accepted").length))}</div>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 flex justify-between">
          <span>
            Synced <strong>{syncResult.saved}</strong> proposal(s) from SharePoint
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
              These SharePoint proposals couldn&apos;t be matched to an existing client with enough confidence. Pick the right client (or leave blank to create a new one) then approve, or discard.
            </p>
          </div>
          <div className="divide-y divide-amber-200">
            {staged.map((record) => {
              const pick = stagedPicks[record.id] ?? { clientId: "", clientName: record.rawClientName };
              return (
                <div key={record.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{record.projectName}</p>
                    <p className="text-xs text-stone-500 truncate">
                      {record.fileName} · raw client: &ldquo;{record.rawClientName || "—"}&rdquo;
                      {record.estimatedAmount ? ` · ${record.currency} ${record.estimatedAmount.toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="w-64">
                    <ClientPicker
                      clients={clients}
                      clientId={pick.clientId}
                      clientName={pick.clientName}
                      onChange={(clientId, clientName) => pickForStaged(record.id, clientId, clientName)}
                      onClientCreated={(c) => setClients((cs) => [...cs, c])}
                      className={input}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={resolvingStaged === record.id}
                    onClick={() => handleApproveStaged(record)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resolvingStaged === record.id}
                    onClick={() => handleRejectStaged(record)}
                  >
                    Discard
                  </Button>
                </div>
              );
            })}
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
      ) : proposals.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("proposals_empty_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("proposals_empty_action")}</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("proposals_col_project")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_client")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_date")}</th>
                <th className="px-4 py-3 text-right">{t("proposals_col_amount")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_verification")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_contract")}</th>
                <th className="px-4 py-3 text-left">{t("proposals_col_folder")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {proposals.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-900">{p.projectName}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {p.clientName || (p.clientId ? clientName(p.clientId) : "—")}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{p.proposalDate}</td>
                  <td className="px-4 py-3 text-right text-stone-700 font-medium">
                    {p.currency} {p.estimatedAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <VerificationBadge
                      verification={p.verification}
                      onVerify={() => handleVerify(p)}
                      verifying={verifying === p.id}
                      verifyLabel={t("proposals_action_verify")}
                      reverifyLabel={t("proposals_action_reverify")}
                    />
                  </td>
                  <td className="px-4 py-3 text-stone-400 font-mono text-xs">{p.contractId || "—"}</td>
                  <td className="px-4 py-3">
                    {p.folderUrl
                      ? <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{t("proposals_folder_open")}</a>
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      {p.status === "submitted" && (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={accepting === p.id}
                          onClick={() => handleAccept(p)}
                        >
                          {t("proposals_action_accept")}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>{t("proposals_action_edit")}</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>{t("proposals_action_delete")}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Post-accept confirmation modal */}
      {acceptedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-6 py-5 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-stone-900 mb-1">{t("proposals_accepted_title")}</h2>
              <p className="text-sm text-stone-500 mb-5">{acceptedResult.proposal.projectName}</p>

              <div className="bg-stone-50 rounded-lg px-4 py-3 text-left space-y-2 mb-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">{t("proposals_label_contract_created")}</span>
                  <span className="font-mono text-stone-700 text-xs">{acceptedResult.contract.id}</span>
                </div>
                {acceptedResult.leadsAdvanced > 0 && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">{t("proposals_label_leads_advanced")}</span>
                    <span className="font-medium text-emerald-600">{acceptedResult.leadsAdvanced}</span>
                  </div>
                )}
                {acceptedResult.clientEmail && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">{t("proposals_label_client_email")}</span>
                    <span className="text-stone-600 text-xs">{acceptedResult.clientEmail}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-stone-400 mb-4">
                {t("proposals_accepted_helper")}
              </p>

              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  onClick={() => { openOutlookCompose(acceptedResult); }}
                >
                  {t("proposals_send_confirmation")}
                </Button>
                <Button variant="secondary" onClick={() => setAcceptedResult(null)}>
                  {t("proposals_done")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? t("proposals_modal_edit_title") : t("proposals_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("proposals_field_project_name")}>
                <input className={input} value={form.projectName} onChange={e => set("projectName", e.target.value)} placeholder={t("proposals_field_project_name_placeholder")} />
              </Field>
              <Field label={t("proposals_field_client")}>
                <ClientPicker
                  clients={clients}
                  clientId={form.clientId}
                  clientName={form.clientName ?? ""}
                  onChange={(clientId, clientName) => setForm(f => ({ ...f, clientId, clientName }))}
                  onClientCreated={(c) => setClients(cs => [...cs, c])}
                  className={input}
                />
              </Field>
              <Field label={t("proposals_field_lead")}>
                <select
                  className={input}
                  value={form.leadId ?? ""}
                  disabled={!!editing}
                  onChange={e => set("leadId", e.target.value)}
                >
                  <option value="">{t("proposals_field_lead_placeholder")}</option>
                  {leads
                    .filter(l => !form.clientId || l.clientId === form.clientId)
                    .map(l => (
                      <option key={l.id} value={l.id}>{l.title} — {l.clientName}</option>
                    ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("proposals_field_date")}>
                  <input type="date" className={input} value={form.proposalDate} onChange={e => set("proposalDate", e.target.value)} />
                </Field>
                <Field label={t("proposals_field_currency")}>
                  <select className={input} value={form.currency} onChange={e => set("currency", e.target.value)}>
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
              <Field label={t("proposals_field_amount")}>
                <input type="number" className={input} value={form.estimatedAmount || ""} onChange={e => set("estimatedAmount", Number(e.target.value))} placeholder="0" />
              </Field>
              <Field label={t("proposals_field_description")}>
                <textarea className={`${input} h-20 resize-none`} value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("proposals_field_description_placeholder")} />
              </Field>
              <Field label={t("proposals_field_status")}>
                <select className={input} value={form.status} onChange={e => set("status", e.target.value as Proposal["status"])}>
                  {STATUSES.map((v) => (
                    <option key={v} value={v}>{statusLabel(v)}</option>
                  ))}
                </select>
              </Field>
              <div className="border-t border-stone-100 pt-4 space-y-4">
                <p className="text-xs text-stone-400">{t("proposals_field_pipeline_links")}</p>
                <Field label={t("proposals_field_contract_id")}>
                  <input className={input} value={form.contractId ?? ""} onChange={e => set("contractId", e.target.value)} placeholder={t("proposals_field_contract_id_placeholder")} />
                </Field>
                <Field label={t("proposals_field_folder_url")}>
                  <input className={input} value={form.folderUrl ?? ""} onChange={e => set("folderUrl", e.target.value)} placeholder="https://drive.google.com/..." />
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("proposals_action_save")}</Button>
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
