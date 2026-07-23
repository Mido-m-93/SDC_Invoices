"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import LeadKanban from "@/components/pipeline/LeadKanban";
import ClientPicker from "@/components/ui/ClientPicker";
import { useLanguage, type TranslationKey } from "@/translations";
import type { Lead, LeadStage, Client } from "@/types";
import { generateId } from "@/lib/utils";

const STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost", "on_hold"];

const STAGE_COLORS: Record<LeadStage, string> = {
  new: "bg-stone-100 text-stone-600",
  contacted: "bg-blue-100 text-blue-700",
  qualified: "bg-indigo-100 text-indigo-700",
  proposal_sent: "bg-violet-100 text-violet-700",
  negotiation: "bg-amber-100 text-amber-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-600",
  on_hold: "bg-orange-100 text-orange-700",
};

const EMPTY_FORM: Omit<Lead, "id" | "createdAt" | "updatedAt" | "proposalId"> = {
  title: "", clientId: "", clientName: "", contactName: "", contactEmail: "",
  source: "inbound", stage: "new", estimatedValue: 0, currency: "JPY",
  probability: 0, expectedCloseDate: "", assignedTo: "", notes: "", lostReason: "",
};

export default function LeadsPage() {
  const { t } = useLanguage();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all");
  const [viewMode, setViewMode] = useState<"table" | "board">("table");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, cRes] = await Promise.all([
        fetch("/api/leads"),
        fetch("/api/clients"),
      ]);
      const lData = await lRes.json() as { leads: Lead[] };
      const cData = await cRes.json() as { clients: Client[] };
      setLeads(lData.leads ?? []);
      setClients(cData.clients ?? []);
    } catch {
      setError(t("leads_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const stageLabel = useCallback((s: LeadStage) => t(`leads_stage_${s}` as TranslationKey), [t]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const active = leads.filter(l => !["won", "lost"].includes(l.stage));
    const won = leads.filter(l => l.stage === "won");
    return {
      total: leads.length,
      active: active.length,
      pipelineValue: active.reduce((s, l) => s + l.estimatedValue, 0),
      won: won.length,
      wonValue: won.reduce((s, l) => s + l.estimatedValue, 0),
    };
  }, [leads]);

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
      setError(t("leads_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("leads_delete_confirm"))) return;
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    load();
  }

  async function handleStageChange(id: string, stage: LeadStage) {
    try {
      await fetch(`/api/leads/${id}/stage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      setLeads(ls => ls.map(l => l.id === id ? { ...l, stage } : l));
    } catch {
      setError(t("leads_stage_update_failed"));
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const filtered = stageFilter === "all" ? leads : leads.filter((l) => l.stage === stageFilter);

  const stageCount = (stage: LeadStage) => leads.filter((l) => l.stage === stage).length;

  return (
    <AppShell>
      <PageHeader
        title={t("leads_title")}
        subtitle={t("leads_subtitle")}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === "table" ? "bg-white shadow text-stone-800" : "text-stone-500 hover:text-stone-700"}`}
              >
                {t("leads_view_table")}
              </button>
              <button
                onClick={() => setViewMode("board")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === "board" ? "bg-white shadow text-stone-800" : "text-stone-500 hover:text-stone-700"}`}
              >
                {t("leads_view_board")}
              </button>
            </div>
            <Button variant="primary" onClick={openNew}>{t("leads_add")}</Button>
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          { label: t("leads_summary_total"), value: summary.total },
          { label: t("leads_summary_active_pipeline"), value: `¥${summary.pipelineValue.toLocaleString("ja-JP")}`, sub: t("leads_summary_active_sub").replace("{count}", String(summary.active)) },
          { label: t("leads_summary_won"), value: summary.won, sub: summary.wonValue > 0 ? `¥${summary.wonValue.toLocaleString("ja-JP")}` : undefined },
          { label: t("leads_summary_stages"), value: t("leads_summary_stages_active").replace("{count}", String(STAGES.filter(s => stageCount(s) > 0).length)) },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-xs text-stone-400 font-medium mb-1">{label}</div>
            <div className="text-lg font-semibold text-stone-800">{value}</div>
            {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Stage filter pills (table mode only) */}
      {viewMode === "table" && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setStageFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${stageFilter === "all" ? "bg-[#1a3d2b] text-white border-[#1a3d2b]" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
          >
            {t("leads_filter_all")}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stageFilter === "all" ? "bg-white/20" : "bg-stone-100"}`}>{leads.length}</span>
          </button>
          {STAGES.map((stage) => (
            <button
              key={stage}
              onClick={() => setStageFilter(stage)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${stageFilter === stage ? "bg-[#1a3d2b] text-white border-[#1a3d2b]" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
            >
              {stageLabel(stage)}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stageFilter === stage ? "bg-white/20" : "bg-stone-100"}`}>{stageCount(stage)}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : viewMode === "board" ? (
        leads.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
            <p className="text-stone-400 text-sm">{t("leads_empty_board_title")}</p>
            <Button variant="primary" className="mt-4" onClick={openNew}>{t("leads_empty_cta")}</Button>
          </div>
        ) : (
          <LeadKanban leads={leads} onEdit={openEdit} onStageChange={handleStageChange} />
        )
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("leads_empty_table_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("leads_empty_cta")}</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("leads_col_title")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_client")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_stage")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_value")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_probability")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_expected_close")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_assigned_to")}</th>
                <th className="px-4 py-3 text-left">{t("leads_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{l.title}</td>
                  <td className="px-4 py-3 text-stone-600">{l.clientName || l.clientId || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[l.stage]}`}>
                      {stageLabel(l.stage)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    {l.estimatedValue > 0 ? `¥${l.estimatedValue.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{l.probability > 0 ? `${l.probability}%` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 font-mono">{l.expectedCloseDate || "—"}</td>
                  <td className="px-4 py-3 text-stone-600">{l.assignedTo || "—"}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>{t("leads_action_edit")}</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(l.id)}>{t("leads_action_delete")}</Button>
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
              <h2 className="text-base font-semibold">{editing ? t("leads_modal_edit_title") : t("leads_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("leads_field_title")}>
                <input className={input} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("leads_field_title_placeholder")} />
              </Field>
              <Field label={t("leads_field_client")}>
                <ClientPicker
                  clients={clients}
                  clientId={form.clientId}
                  clientName={form.clientName}
                  onChange={(clientId, clientName) => setForm(f => ({ ...f, clientId, clientName }))}
                  onClientCreated={(c) => setClients(cs => [...cs, c])}
                  className={input}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("leads_field_contact_name")}>
                  <input className={input} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder={t("leads_field_contact_name_placeholder")} />
                </Field>
                <Field label={t("leads_field_contact_email")}>
                  <input type="email" className={input} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder={t("leads_field_contact_email_placeholder")} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("leads_field_source")}>
                  <select className={input} value={form.source} onChange={(e) => set("source", e.target.value as typeof form.source)}>
                    <option value="referral">{t("leads_source_referral")}</option>
                    <option value="inbound">{t("leads_source_inbound")}</option>
                    <option value="outbound">{t("leads_source_outbound")}</option>
                    <option value="event">{t("leads_source_event")}</option>
                    <option value="partner">{t("leads_source_partner")}</option>
                    <option value="other">{t("leads_source_other")}</option>
                  </select>
                </Field>
                <Field label={t("leads_field_stage")}>
                  <select className={input} value={form.stage} onChange={(e) => set("stage", e.target.value as LeadStage)}>
                    {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("leads_field_estimated_value")}>
                  <input type="number" className={input} value={form.estimatedValue || ""} onChange={(e) => set("estimatedValue", Number(e.target.value))} placeholder="500000" />
                </Field>
                <Field label={t("leads_field_currency")}>
                  <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("leads_field_probability")}>
                  <input type="number" min="0" max="100" className={input} value={form.probability || ""} onChange={(e) => set("probability", Math.min(100, Math.max(0, Number(e.target.value))))} placeholder="50" />
                </Field>
                <Field label={t("leads_field_expected_close_date")}>
                  <input type="date" className={input} value={form.expectedCloseDate} onChange={(e) => set("expectedCloseDate", e.target.value)} />
                </Field>
              </div>
              <Field label={t("leads_field_assigned_to")}>
                <input className={input} value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} placeholder={t("leads_field_assigned_to_placeholder")} />
              </Field>
              <Field label={t("leads_field_notes")}>
                <textarea className={`${input} resize-none`} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("leads_field_notes_placeholder")} />
              </Field>
              {form.stage === "lost" && (
                <Field label={t("leads_field_lost_reason")}>
                  <input className={input} value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} placeholder={t("leads_field_lost_reason_placeholder")} />
                </Field>
              )}
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("leads_save")}</Button>
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
