"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Lead, LeadStage } from "@/types";
import { generateId } from "@/lib/utils";

const STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost", "on_hold"];

const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  on_hold: "On Hold",
};

const STAGE_COLORS: Record<LeadStage, string> = {
  new: "bg-stone-100 text-stone-600",
  contacted: "bg-blue-100 text-blue-700",
  qualified: "bg-indigo-100 text-indigo-700",
  proposal_sent: "bg-violet-100 text-violet-700",
  negotiation: "bg-amber-100 text-amber-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-600",
  on_hold: "bg-orange-100 text-orange-700",
};

const EMPTY_FORM: Omit<Lead, "id" | "createdAt" | "updatedAt" | "proposalId"> = {
  title: "",
  clientId: "",
  clientName: "",
  contactName: "",
  contactEmail: "",
  source: "inbound",
  stage: "new",
  estimatedValue: 0,
  currency: "JPY",
  probability: 0,
  expectedCloseDate: "",
  assignedTo: "",
  notes: "",
  lostReason: "",
};

interface LeadSummaryByStage {
  byStage: Record<LeadStage, number>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [summary, setSummary] = useState<LeadSummaryByStage | null>(null);
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads");
      const data = await res.json() as { leads: Lead[]; summary?: LeadSummaryByStage };
      setLeads(data.leads ?? []);
      if (data.summary) setSummary(data.summary);
    } catch {
      setError("Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(l: Lead) {
    setEditing(l);
    const { id: _id, createdAt: _c, updatedAt: _u, proposalId: _p, ...rest } = l;
    setForm({ ...rest });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await fetch(`/api/leads/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, id: generateId("lead") }),
        });
      }
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save lead");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this lead?")) return;
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const filtered = stageFilter === "all" ? leads : leads.filter((l) => l.stage === stageFilter);

  const stageCount = (stage: LeadStage): number => {
    if (summary) return summary.byStage[stage] ?? 0;
    return leads.filter((l) => l.stage === stage).length;
  };

  return (
    <AppShell>
      <PageHeader
        title="Lead Pipeline"
        subtitle="Sales pipeline from prospect to won deal"
        actions={<Button variant="primary" onClick={openNew}>+ Add Lead</Button>}
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Stage filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setStageFilter("all")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            stageFilter === "all"
              ? "bg-[#1a3d2b] text-white border-[#1a3d2b]"
              : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
          }`}
        >
          All
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stageFilter === "all" ? "bg-white/20" : "bg-stone-100"}`}>
            {leads.length}
          </span>
        </button>
        {STAGES.map((stage) => (
          <button
            key={stage}
            onClick={() => setStageFilter(stage)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              stageFilter === stage
                ? "bg-[#1a3d2b] text-white border-[#1a3d2b]"
                : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
            }`}
          >
            {STAGE_LABELS[stage]}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stageFilter === stage ? "bg-white/20" : "bg-stone-100"}`}>
              {stageCount(stage)}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No leads found.</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>Add your first lead</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Stage</th>
                <th className="px-4 py-3 text-left">Value</th>
                <th className="px-4 py-3 text-left">Probability (%)</th>
                <th className="px-4 py-3 text-left">Expected Close</th>
                <th className="px-4 py-3 text-left">Assigned To</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{l.title}</td>
                  <td className="px-4 py-3 text-stone-600">{l.clientName || l.clientId || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[l.stage]}`}>
                      {STAGE_LABELS[l.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    {l.estimatedValue > 0
                      ? `${l.currency === "JPY" ? "¥" : l.currency + " "}${l.estimatedValue.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{l.probability > 0 ? `${l.probability}%` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 font-mono">{l.expectedCloseDate || "—"}</td>
                  <td className="px-4 py-3 text-stone-600">{l.assignedTo || "—"}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(l.id)}>Delete</Button>
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
              <h2 className="text-base font-semibold">{editing ? "Edit Lead" : "Add Lead"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Title *">
                <input className={input} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Deal or opportunity title" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client ID">
                  <input className={input} value={form.clientId} onChange={(e) => set("clientId", e.target.value)} placeholder="client-001" />
                </Field>
                <Field label="Client Name">
                  <input className={input} value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Acme Corp" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contact Name">
                  <input className={input} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Jane Smith" />
                </Field>
                <Field label="Contact Email">
                  <input type="email" className={input} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="jane@acme.com" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Source">
                  <select className={input} value={form.source} onChange={(e) => set("source", e.target.value as typeof form.source)}>
                    <option value="referral">Referral</option>
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                    <option value="event">Event</option>
                    <option value="partner">Partner</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Stage">
                  <select className={input} value={form.stage} onChange={(e) => set("stage", e.target.value as LeadStage)}>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Estimated Value">
                  <input type="number" className={input} value={form.estimatedValue || ""} onChange={(e) => set("estimatedValue", Number(e.target.value))} placeholder="500000" />
                </Field>
                <Field label="Currency">
                  <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option value="JPY">JPY — Japanese Yen</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Probability (0–100)">
                  <input type="number" min="0" max="100" className={input} value={form.probability || ""} onChange={(e) => set("probability", Math.min(100, Math.max(0, Number(e.target.value))))} placeholder="50" />
                </Field>
                <Field label="Expected Close Date">
                  <input type="date" className={input} value={form.expectedCloseDate} onChange={(e) => set("expectedCloseDate", e.target.value)} />
                </Field>
              </div>
              <Field label="Assigned To">
                <input className={input} value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} placeholder="Sales rep name or email" />
              </Field>
              <Field label="Notes">
                <textarea className={`${input} resize-none`} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Additional notes…" />
              </Field>
              {form.stage === "lost" && (
                <Field label="Lost Reason">
                  <input className={input} value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} placeholder="Why was this lead lost?" />
                </Field>
              )}
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save Lead</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
