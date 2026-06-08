"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { OutboundInvoice, OutboundInvoiceStatus, OutboundInvoiceSummary } from "@/types";

const STATUS_LABELS: Record<OutboundInvoiceStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

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

export default function OutboundInvoicesPage() {
  const [invoices, setInvoices] = useState<OutboundInvoice[]>([]);
  const [summary, setSummary] = useState<OutboundInvoiceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      const res = await fetch(`/api/outbound-invoices?${params}`);
      const data = await res.json() as { invoices: OutboundInvoice[]; summary: OutboundInvoiceSummary };
      setInvoices(data.invoices ?? []);
      setSummary(data.summary ?? null);
    } catch { setError("Failed to load outbound invoices"); }
    finally { setLoading(false); }
  }, [statusFilter, monthFilter]);

  useEffect(() => { load(); }, [load]);

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
    setSaving(true);
    const payload = { ...form, total: form.subtotal + form.taxAmount };
    try {
      const url = editing ? `/api/outbound-invoices/${editing.id}` : "/api/outbound-invoices";
      const method = editing ? "PUT" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setShowForm(false);
      load();
    } catch { setError("Failed to save invoice"); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(id: string, status: OutboundInvoiceStatus) {
    try {
      await fetch(`/api/outbound-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actorName: "system" }),
      });
      load();
    } catch { setError("Failed to update status"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this outbound invoice?")) return;
    await fetch(`/api/outbound-invoices/${id}`, { method: "DELETE" });
    load();
  }

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === "subtotal" || k === "taxAmount") next.total = (Number(next.subtotal) || 0) + (Number(next.taxAmount) || 0);
    return next;
  });

  return (
    <AppShell>
      <PageHeader
        title="Outbound Invoices"
        subtitle="Track invoices issued to clients and payment collection"
        actions={<Button variant="primary" onClick={openNew}>+ New Invoice</Button>}
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
        ⚠ This tool tracks outbound invoice status. Actual invoice sending and payment collection are handled separately.
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" value={summary.total} />
          <StatCard label="Sent" value={summary.sent} color="blue" />
          <StatCard label="Overdue" value={summary.overdue} color="red" />
          <StatCard label="Outstanding" value={fmt(summary.totalOutstanding, summary.currency)} color="amber" />
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
            {s === "all" ? "All" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No outbound invoices found for this month.</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>Create first invoice</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Invoice #</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Billing Month</th>
                <th className="px-4 py-3 text-left">Due Date</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className={`hover:bg-stone-50 ${inv.status === "overdue" ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{inv.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 font-medium text-stone-800">{inv.clientName || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{inv.projectName || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{inv.billingMonth}</td>
                  <td className={`px-4 py-3 ${inv.status === "overdue" ? "text-red-600 font-medium" : "text-stone-500"}`}>{inv.dueDate || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-stone-800">{fmt(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[inv.status]}`}>
                      {STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(inv)}>Edit</Button>
                    {inv.status === "draft" && (
                      <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv.id, "sent")}>Mark Sent</Button>
                    )}
                    {inv.status === "sent" && (
                      <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv.id, "paid")}>Mark Paid</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(inv.id)}>Delete</Button>
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
              <h2 className="text-base font-semibold">{editing ? "Edit Outbound Invoice" : "New Outbound Invoice"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Invoice Number">
                  <input className={inp} value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder="INV-2024-001" />
                </Field>
                <Field label="Billing Month">
                  <input className={inp} type="month" value={form.billingMonth} onChange={(e) => set("billingMonth", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Client Name *">
                  <input className={inp} value={form.clientName} onChange={(e) => set("clientName", e.target.value)} />
                </Field>
                <Field label="Project Name">
                  <input className={inp} value={form.projectName} onChange={(e) => set("projectName", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Issue Date">
                  <input className={inp} type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
                </Field>
                <Field label="Due Date">
                  <input className={inp} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Subtotal">
                  <input className={inp} type="number" value={form.subtotal} onChange={(e) => set("subtotal", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label="Tax Amount">
                  <input className={inp} type="number" value={form.taxAmount} onChange={(e) => set("taxAmount", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label="Total">
                  <input className={`${inp} bg-stone-50`} value={form.total} readOnly />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Currency">
                  <select className={inp} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option>JPY</option><option>USD</option><option>EUR</option>
                  </select>
                </Field>
                <Field label="Created By">
                  <input className={inp} value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={`${inp} h-16`} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save Invoice</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
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
