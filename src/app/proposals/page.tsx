"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Proposal, Client } from "@/types";
import { generateId } from "@/lib/utils";

const STATUS_LABELS: Record<Proposal["status"], string> = {
  draft: "Draft", submitted: "Submitted", accepted: "Accepted",
  rejected: "Rejected", expired: "Expired",
};

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
  clientId: "", clientName: "", projectName: "", proposalDate: "",
  estimatedAmount: 0, currency: "JPY", description: "",
  status: "draft", contractId: "", folderUrl: "",
};

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProposalForm>({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptedResult, setAcceptedResult] = useState<AcceptedResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/proposals"),
        fetch("/api/clients"),
      ]);
      const pData = await pRes.json() as { proposals: Proposal[] };
      const cData = await cRes.json() as { clients: Client[] };
      setProposals(pData.proposals ?? []);
      setClients(cData.clients ?? []);
    } catch {
      setError("Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

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
      clientId: p.clientId, clientName: p.clientName ?? "",
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
        setError(data.error ?? "Failed to save proposal");
        return;
      }
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

  async function handleAccept(p: Proposal) {
    if (!confirm(`Accept proposal "${p.projectName}"?\n\nThis will:\n• Mark the proposal as Accepted\n• Create a draft contract pre-filled with client and project details\n• Advance any linked lead to Won`)) return;
    setAccepting(p.id);
    try {
      const res = await fetch(`/api/proposals/${p.id}/accept`, { method: "POST" });
      const data = await res.json() as { success: boolean; proposal: Proposal; contract: { id: string; projectName: string }; leadsAdvanced: number; error?: string };
      if (!res.ok) { setError(`Accept failed: ${data.error ?? "unknown error"}`); return; }
      const client = clients.find(c => c.id === p.clientId);
      setAcceptedResult({
        proposal: data.proposal,
        contract: data.contract,
        leadsAdvanced: data.leadsAdvanced,
        clientEmail: client?.contactEmail,
      });
      load();
    } catch {
      setError("Failed to accept proposal");
    } finally {
      setAccepting(null);
    }
  }

  function openOutlookCompose(result: AcceptedResult) {
    const to = result.clientEmail ?? "";
    const subject = encodeURIComponent(`[RoboCo-op] Proposal Accepted — ${result.proposal.projectName}`);
    const body = encodeURIComponent(
      `Dear ${result.proposal.clientName ?? "Client"},\n\n` +
      `We are pleased to confirm that your proposal for "${result.proposal.projectName}" has been accepted.\n\n` +
      `Project: ${result.proposal.projectName}\n` +
      `Amount: ${result.proposal.currency} ${result.proposal.estimatedAmount.toLocaleString()}\n` +
      `Contract Reference: ${result.contract.id}\n\n` +
      `Our team will be in touch shortly to discuss next steps and finalise the contract details.\n\n` +
      `Best regards,\nRoboCo-op Team`
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
        title="Proposals"
        subtitle="Track proposals sent to clients — the bridge between Lead and Contract"
        actions={<Button variant="primary" onClick={openNew}>+ Add Proposal</Button>}
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">Total Proposals</div>
          <div className="text-lg font-semibold text-stone-800">{proposals.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">Pending Review</div>
          <div className="text-lg font-semibold text-stone-800">{pending}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
          <div className="text-xs text-stone-400 font-medium mb-1">Won Value</div>
          <div className="text-lg font-semibold text-stone-800">¥{totalValue.toLocaleString("ja-JP")}</div>
          <div className="text-xs text-stone-400 mt-0.5">{proposals.filter(p => p.status === "accepted").length} accepted</div>
        </div>
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
          <Button variant="primary" className="mt-4" onClick={openNew}>Add first proposal</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Contract</th>
                <th className="px-4 py-3 text-left">Folder</th>
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
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-400 font-mono text-xs">{p.contractId || "—"}</td>
                  <td className="px-4 py-3">
                    {p.folderUrl
                      ? <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">Open</a>
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
                          Accept
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>Delete</Button>
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
              <h2 className="text-lg font-semibold text-stone-900 mb-1">Proposal Accepted</h2>
              <p className="text-sm text-stone-500 mb-5">{acceptedResult.proposal.projectName}</p>

              <div className="bg-stone-50 rounded-lg px-4 py-3 text-left space-y-2 mb-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">Contract created</span>
                  <span className="font-mono text-stone-700 text-xs">{acceptedResult.contract.id}</span>
                </div>
                {acceptedResult.leadsAdvanced > 0 && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Leads advanced to Won</span>
                    <span className="font-medium text-emerald-600">{acceptedResult.leadsAdvanced}</span>
                  </div>
                )}
                {acceptedResult.clientEmail && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Client email</span>
                    <span className="text-stone-600 text-xs">{acceptedResult.clientEmail}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-stone-400 mb-4">
                The contract is saved as a draft — open it in Contracts to fill in start/end dates and payment terms.
              </p>

              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  onClick={() => { openOutlookCompose(acceptedResult); }}
                >
                  Send Confirmation via Outlook
                </Button>
                <Button variant="secondary" onClick={() => setAcceptedResult(null)}>
                  Done
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
              <h2 className="text-base font-semibold">{editing ? "Edit Proposal" : "Add Proposal"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Project Name *">
                <input className={input} value={form.projectName} onChange={e => set("projectName", e.target.value)} placeholder="Project or engagement name" />
              </Field>
              <Field label="Client">
                <select
                  className={input}
                  value={form.clientId}
                  onChange={(e) => {
                    const client = clients.find(c => c.id === e.target.value);
                    setForm(f => ({ ...f, clientId: e.target.value, clientName: client?.name ?? f.clientName }));
                  }}
                >
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              {!form.clientId && (
                <Field label="Client Name (if not in list)">
                  <input className={input} value={form.clientName ?? ""} onChange={e => set("clientName", e.target.value)} placeholder="Client company name" />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Proposal Date">
                  <input type="date" className={input} value={form.proposalDate} onChange={e => set("proposalDate", e.target.value)} />
                </Field>
                <Field label="Currency">
                  <select className={input} value={form.currency} onChange={e => set("currency", e.target.value)}>
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
              <Field label="Estimated Amount">
                <input type="number" className={input} value={form.estimatedAmount || ""} onChange={e => set("estimatedAmount", Number(e.target.value))} placeholder="0" />
              </Field>
              <Field label="Description">
                <textarea className={`${input} h-20 resize-none`} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Scope, deliverables, notes…" />
              </Field>
              <Field label="Status">
                <select className={input} value={form.status} onChange={e => set("status", e.target.value as Proposal["status"])}>
                  {(Object.entries(STATUS_LABELS) as [Proposal["status"], string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <div className="border-t border-stone-100 pt-4 space-y-4">
                <p className="text-xs text-stone-400">Pipeline links (optional)</p>
                <Field label="Linked Contract ID">
                  <input className={input} value={form.contractId ?? ""} onChange={e => set("contractId", e.target.value)} placeholder="con-xxxx (when accepted)" />
                </Field>
                <Field label="Folder URL">
                  <input className={input} value={form.folderUrl ?? ""} onChange={e => set("folderUrl", e.target.value)} placeholder="https://drive.google.com/..." />
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save Proposal</Button>
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
