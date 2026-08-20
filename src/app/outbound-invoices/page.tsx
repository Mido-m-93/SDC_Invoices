"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import VerificationBadge from "@/components/ui/VerificationBadge";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import type { OutboundInvoice, OutboundInvoiceStatus, OutboundInvoiceSummary, Contract } from "@/types";

const STATUS_COLORS: Record<OutboundInvoiceStatus, string> = {
  draft: "bg-stone-100 text-stone-500",
  pending_approval: "bg-amber-100 text-amber-700",
  sent: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
  paid: "bg-green-100 text-green-700",
  cancelled: "bg-stone-100 text-stone-400",
};

const EMPTY_FORM: Omit<OutboundInvoice, "id" | "createdAt" | "updatedAt" | "sentAt" | "paidAt" | "paidAmount" | "approvedBy" | "approvedAt"> = {
  contractId: "",
  clientId: "",
  clientName: "",
  projectName: "",
  invoiceNumber: "",
  billingMonth: new Date().toISOString().slice(0, 7),
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  subtotal: 0,
  taxAmount: 0,
  total: 0,
  currency: "JPY",
  status: "draft",
  notes: "",
  createdBy: "",
};

function fmt(n: number, currency = "JPY") {
  return `${currency} ${n.toLocaleString()}`;
}

function OutboundInvoicesPageInner() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const searchParams = useSearchParams();
  const statusLabel = (s: OutboundInvoiceStatus | "all") => t(`outbound_status_${s}` as TranslationKey);

  const [invoices, setInvoices] = useState<OutboundInvoice[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [summary, setSummary] = useState<OutboundInvoiceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OutboundInvoiceStatus | "all">("all");
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OutboundInvoice | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ billingMonth: monthFilter });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const [iRes, cRes] = await Promise.all([
        fetch(`/api/outbound-invoices?${params}`),
        fetch("/api/contracts"),
      ]);
      const data = await iRes.json() as { invoices: OutboundInvoice[]; summary: OutboundInvoiceSummary };
      const cData = await cRes.json() as { contracts: Contract[] };
      setInvoices(data.invoices ?? []);
      setSummary(data.summary ?? null);
      setContracts(cData.contracts ?? []);
    } catch { setError(t("outbound_invoices_load_failed")); }
    finally { setLoading(false); }
  }, [statusFilter, monthFilter, t]);

  useEffect(() => { load(); }, [load]);

  // Pre-open the New Invoice form with a contract preselected when arriving via
  // the Contracts page's "Create Invoice" link (?contractId=...).
  useEffect(() => {
    const contractId = searchParams.get("contractId");
    if (!contractId || contracts.length === 0) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      contractId: contract.id,
      clientId: contract.clientId ?? "",
      clientName: contract.clientName ?? "",
      projectName: contract.projectName,
      currency: contract.currency,
    });
    setShowForm(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts]);

  function selectContract(contractId: string) {
    const contract = contracts.find(c => c.id === contractId);
    setForm(f => ({
      ...f,
      contractId,
      clientId: contract?.clientId ?? "",
      clientName: contract?.clientName ?? "",
      projectName: contract?.projectName ?? "",
      currency: contract?.currency ?? f.currency,
    }));
  }

  async function handleVerify(inv: OutboundInvoice) {
    setVerifying(inv.id);
    try {
      const res = await fetch(`/api/outbound-invoices/${inv.id}/verify`, { method: "POST" });
      if (res.ok) {
        load();
        notify("success", `Verified invoice ${inv.invoiceNumber || inv.id}`, "/outbound-invoices");
      } else {
        notify("error", `Failed to verify invoice ${inv.invoiceNumber || inv.id}`, "/outbound-invoices");
      }
    } catch (err) {
      notify("error", `Failed to verify invoice ${inv.invoiceNumber || inv.id}: ${String(err)}`, "/outbound-invoices");
    } finally {
      setVerifying(null);
    }
  }

  function contractLabel(contractId: string): string {
    const c = contracts.find(c => c.id === contractId);
    return c ? c.projectName : contractId || "—";
  }

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(inv: OutboundInvoice) {
    setEditing(inv);
    setForm({
      contractId: inv.contractId,
      clientId: inv.clientId,
      clientName: inv.clientName,
      projectName: inv.projectName,
      invoiceNumber: inv.invoiceNumber,
      billingMonth: inv.billingMonth,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount,
      total: inv.total,
      currency: inv.currency,
      status: inv.status,
      notes: inv.notes,
      createdBy: inv.createdBy,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.contractId) {
      setError(t("outbound_field_contract_required"));
      return;
    }
    setSaving(true);
    const payload = { ...form, total: form.subtotal + form.taxAmount };
    try {
      const url = editing ? `/api/outbound-invoices/${editing.id}` : "/api/outbound-invoices";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? t("outbound_invoices_save_failed"));
        notify("error", `Failed to save invoice ${form.invoiceNumber || form.clientName}: ${data.error ?? t("outbound_invoices_save_failed")}`, "/outbound-invoices");
        return;
      }
      setShowForm(false);
      load();
      notify("success", `${editing ? "Updated" : "Created"} invoice ${form.invoiceNumber || form.clientName}`, "/outbound-invoices");
    } catch (err) {
      setError(t("outbound_invoices_save_failed"));
      notify("error", `Failed to save invoice ${form.invoiceNumber || form.clientName}: ${String(err)}`, "/outbound-invoices");
    }
    finally { setSaving(false); }
  }

  async function handleStatusChange(id: string, status: OutboundInvoiceStatus) {
    try {
      const res = await fetch(`/api/outbound-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actorName: "system" }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      load();
      notify("success", `Marked invoice as ${statusLabel(status)}`, "/outbound-invoices");
    } catch (err) {
      setError(t("outbound_invoices_status_update_failed"));
      notify("error", `Failed to update invoice status: ${String(err)}`, "/outbound-invoices");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("outbound_invoices_delete_confirm"))) return;
    try {
      const res = await fetch(`/api/outbound-invoices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      load();
      notify("success", "Deleted invoice", "/outbound-invoices");
    } catch (err) {
      setError(`Failed to delete invoice: ${String(err)}`);
      notify("error", `Failed to delete invoice: ${String(err)}`, "/outbound-invoices");
    }
  }

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === "subtotal" || k === "taxAmount") next.total = (Number(next.subtotal) || 0) + (Number(next.taxAmount) || 0);
    return next;
  });

  return (
    <AppShell>
      <PageHeader
        title={t("outbound_invoices_title")}
        subtitle={t("outbound_invoices_subtitle")}
        actions={<Button variant="primary" onClick={openNew}>{t("outbound_new_invoice")}</Button>}
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
        {t("outbound_invoices_notice")}
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label={t("outbound_invoices_stat_total")} value={summary.total} />
          <StatCard label={t("outbound_status_sent")} value={summary.sent} color="blue" />
          <StatCard label={t("outbound_status_overdue")} value={summary.overdue} color="red" />
          <StatCard label={t("outbound_stat_outstanding")} value={fmt(summary.totalOutstanding, summary.currency)} color="amber" />
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}<button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
        />
        {(["all", "draft", "pending_approval", "sent", "overdue", "paid", "cancelled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${statusFilter === s ? "bg-[#1a3d2b] text-white border-[#1a3d2b]" : "text-stone-500 border-stone-200 hover:border-stone-400"}`}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("outbound_invoices_empty_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("outbound_invoices_create_first")}</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("outbound_invoices_col_invoice_number")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_col_client")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_col_project")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_col_contract")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_invoices_billing_month")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_col_due_date")}</th>
                <th className="px-4 py-3 text-right">{t("outbound_invoices_total_label")}</th>
                <th className="px-4 py-3 text-left">{t("col_status")}</th>
                <th className="px-4 py-3 text-left">{t("outbound_col_verification")}</th>
                <th className="px-4 py-3 text-left">{t("col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className={`hover:bg-stone-50 ${inv.status === "overdue" ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{inv.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 font-medium text-stone-800">{inv.clientName || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{inv.projectName || "—"}</td>
                  <td className="px-4 py-3 text-stone-400 text-xs">{contractLabel(inv.contractId)}</td>
                  <td className="px-4 py-3 text-stone-500">{inv.billingMonth}</td>
                  <td className={`px-4 py-3 ${inv.status === "overdue" ? "text-red-600 font-medium" : "text-stone-500"}`}>{inv.dueDate || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-stone-800">{fmt(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[inv.status]}`}>
                      {statusLabel(inv.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <VerificationBadge
                      verification={inv.verification}
                      onVerify={() => handleVerify(inv)}
                      verifying={verifying === inv.id}
                      verifyLabel={t("outbound_action_verify")}
                      reverifyLabel={t("outbound_action_reverify")}
                    />
                  </td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(inv)}>{t("outbound_invoices_action_edit")}</Button>
                    {inv.status === "draft" && (
                      <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv.id, "sent")}>{t("outbound_action_mark_sent")}</Button>
                    )}
                    {inv.status === "sent" && (
                      <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv.id, "paid")}>{t("outbound_action_mark_paid")}</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(inv.id)}>{t("outbound_invoices_action_delete")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? t("outbound_invoices_modal_edit_title") : t("outbound_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("outbound_field_contract")}>
                <select
                  className={inp}
                  value={form.contractId}
                  disabled={!!editing}
                  onChange={(e) => selectContract(e.target.value)}
                >
                  <option value="">{t("outbound_field_contract_placeholder")}</option>
                  {contracts.filter(c => c.status === "active" && c.clientId).map(c => (
                    <option key={c.id} value={c.id}>{c.projectName} — {c.clientName ?? c.clientId}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("outbound_invoices_field_invoice_number")}>
                  <input className={inp} value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder={t("outbound_invoices_field_invoice_number_placeholder")} />
                </Field>
                <Field label={t("outbound_invoices_billing_month")}>
                  <input className={inp} type="month" value={form.billingMonth} onChange={(e) => set("billingMonth", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("outbound_field_client_name")}>
                  <input className={`${inp} bg-stone-50`} value={form.clientName} readOnly />
                </Field>
                <Field label={t("outbound_invoices_field_project_name")}>
                  <input className={`${inp} bg-stone-50`} value={form.projectName} readOnly />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("outbound_invoices_field_issue_date")}>
                  <input className={inp} type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
                </Field>
                <Field label={t("outbound_col_due_date")}>
                  <input className={inp} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label={t("outbound_invoices_field_subtotal")}>
                  <input className={inp} type="number" value={form.subtotal} onChange={(e) => set("subtotal", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label={t("outbound_invoices_field_tax_amount")}>
                  <input className={inp} type="number" value={form.taxAmount} onChange={(e) => set("taxAmount", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label={t("outbound_invoices_total_label")}>
                  <input className={`${inp} bg-stone-50`} value={form.total} readOnly />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("outbound_invoices_field_currency")}>
                  <select className={inp} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option>JPY</option><option>USD</option><option>EUR</option>
                  </select>
                </Field>
                <Field label={t("outbound_invoices_field_created_by")}>
                  <input className={inp} value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} />
                </Field>
              </div>
              <Field label={t("outbound_field_notes")}>
                <textarea className={`${inp} h-16`} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("outbound_invoices_save_invoice")}</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function OutboundInvoicesPage() {
  return (
    <Suspense>
      <OutboundInvoicesPageInner />
    </Suspense>
  );
}

function StatCard({ label, value, color = "stone" }: { label: string; value: number | string; color?: string }) {
  const colors: Record<string, string> = {
    stone: "text-stone-800",
    blue: "text-blue-700",
    red: "text-red-600",
    amber: "text-amber-700",
  };
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <p className="text-xs text-stone-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${colors[color] ?? colors.stone}`}>{value}</p>
    </div>
  );
}

const inp = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
