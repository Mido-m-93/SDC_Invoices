"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MonthSelector from "@/components/ui/MonthSelector";
import { useLanguage, type TranslationKey } from "@/translations";
import { sendExpenseToMoneyForward } from "@/lib/api/client";
import { SHOW_SEND_TO_MF } from "@/lib/featureFlags";
import { monthOptions } from "@/lib/utils";
import type { ExpenseClaim, ExpenseCategory, ExpensePaymentMethod, ExpenseStatus, ExpenseValidationResult } from "@/types";

const CATEGORIES: ExpenseCategory[] = ["transport","accommodation","meals","software","hardware","office_supplies","communication","entertainment","training","other"];
const PAYMENT_METHODS: ExpensePaymentMethod[] = ["company_card","invoice_payment","personal_reimbursement"];
const STATUS_FILTER_VALUES: (ExpenseStatus | "all")[] = ["all", "submitted", "under_review", "approved", "rejected", "paid"];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  draft: "bg-stone-100 text-stone-500",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  paid: "bg-emerald-100 text-emerald-700",
  archived: "bg-stone-100 text-stone-400",
};

const EMPTY_FORM: Omit<ExpenseClaim, "id" | "createdAt" | "updatedAt" | "status" | "reviewerComment" | "reviewedBy" | "reviewedAt" | "approvedBy" | "approvedAt" | "paidAt" | "extractedAmount" | "extractedDate" | "extractedVendor" | "policyViolations" | "submittedAt"> = {
  submittedBy: "",
  submittedByEmail: "",
  category: "other",
  description: "",
  amount: 0,
  currency: "JPY",
  paymentMethod: "personal_reimbursement",
  receiptUrl: "",
  receiptFilename: "",
  projectName: "",
  internalDepartment: "",
  expenseDate: new Date().toISOString().slice(0, 10),
};

export default function ExpensesPage() {
  const { t } = useLanguage();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseClaim | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [validationPanel, setValidationPanel] = useState<{ claim: ExpenseClaim; result: ExpenseValidationResult; receiptUrl?: string | null } | null>(null);
  const [approveAction, setApproveAction] = useState<"approve" | "reject" | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [actorName, setActorName] = useState("");
  const [sendingToMF, setSendingToMF] = useState<string | null>(null);
  const [confirmCleanAll, setConfirmCleanAll] = useState(false);
  const [cleaningAll, setCleaningAll] = useState(false);

  const statusLabel = (s: ExpenseStatus | "all") => t(`expenses_status_${s}` as TranslationKey);
  const categoryLabel = (c: ExpenseCategory) => t(`expenses_category_${c}` as TranslationKey);
  const paymentMethodLabel = (m: ExpensePaymentMethod) => t(`expenses_payment_${m}` as TranslationKey);
  const violationLabel = (v: string) => t(`expenses_violation_${v}` as TranslationKey) || v;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? "/api/expenses" : `/api/expenses?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json() as { claims: ExpenseClaim[] };
      setClaims(data.claims ?? []);
    } catch { setError(t("expenses_load_failed")); }
    finally { setLoading(false); }
  }, [statusFilter, t]);

  useEffect(() => { load(); }, [load]);

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setError(null);
    setUploadMsg(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res  = await fetch("/api/expenses/upload", { method: "POST", body });
      const data = await res.json() as { count?: number; error?: string; detectedHeaders?: string[] };
      if (!res.ok) {
        setError(data.error ?? t("expenses_upload_failed"));
      } else {
        setUploadMsg(t("expenses_imported_msg").replace("{count}", String(data.count ?? 0)).replace("{file}", file.name));
        load();
      }
    } catch {
      setError(t("expenses_upload_failed_format"));
    } finally {
      setUploading(false);
    }
  };

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(c: ExpenseClaim) {
    setEditing(c);
    setForm({
      submittedBy: c.submittedBy,
      submittedByEmail: c.submittedByEmail,
      category: c.category,
      description: c.description,
      amount: c.amount,
      currency: c.currency,
      paymentMethod: c.paymentMethod,
      receiptUrl: c.receiptUrl,
      receiptFilename: c.receiptFilename,
      projectName: c.projectName,
      internalDepartment: c.internalDepartment,
      expenseDate: c.expenseDate,
    });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/expenses/${editing.id}` : "/api/expenses";
      const method = editing ? "PUT" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setShowForm(false);
      load();
    } catch { setError(t("expenses_save_failed")); }
    finally { setSaving(false); }
  }

  async function handleValidate(id: string) {
    setValidating(id);
    const claim = claims.find((c) => c.id === id) ?? null;
    try {
      const res  = await fetch(`/api/expenses/${id}/validate`, { method: "POST" });
      const data = await res.json() as { result?: ExpenseValidationResult; _debug?: { receiptUrl?: string | null } };
      load();
      if (data.result && claim) {
        setValidationPanel({ claim, result: data.result, receiptUrl: data._debug?.receiptUrl ?? null });
      }
    } catch { setError(t("expenses_validation_failed")); }
    finally { setValidating(null); }
  }

  async function handleApprove() {
    if (!approvingId || !approveAction) return;
    try {
      await fetch(`/api/expenses/${approvingId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: approveAction, approvedBy: actorName, comment: approveComment }),
      });
      setApprovingId(null);
      setApproveAction(null);
      setApproveComment("");
      load();
    } catch { setError(t("expenses_status_update_failed")); }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("expenses_delete_confirm"))) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    load();
  }

  async function handleSendToMF(id: string) {
    setSendingToMF(id);
    setError(null);
    try {
      await sendExpenseToMoneyForward(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingToMF(null);
    }
  }

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSyncForms() {
    setSyncing(true);
    setError(null);
    setUploadMsg(null);
    try {
      const res  = await fetch("/api/expenses/sync-forms", { method: "POST" });
      const data = await res.json() as { count?: number; synced?: number; totalRows?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? t("expenses_sync_failed"));
      } else {
        const n = data.count ?? data.synced ?? 0;
        const total = data.totalRows ?? n;
        const skipped = data.skipped ?? 0;
        const skipNote = skipped > 0 ? t("expenses_skipped_rows").replace("{skipped}", String(skipped)) : "";
        setUploadMsg(t("expenses_synced_msg").replace("{n}", String(n)).replace("{total}", String(total)) + skipNote);
        load();
      }
    } catch {
      setError(t("expenses_sync_failed_logs"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleCleanAll() {
    setCleaningAll(true);
    setError(null);
    try {
      const res = await fetch("/api/expenses", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? t("expenses_sync_failed"));
      } else {
        setClaims([]);
        setConfirmCleanAll(false);
      }
    } catch {
      setError(t("expenses_sync_failed_logs"));
    } finally {
      setCleaningAll(false);
    }
  }

  const availableMonths = Array.from(new Set(claims.map((c) => c.expenseDate?.slice(0, 7)).filter(Boolean))) as string[];
  const visibleClaims = claims.filter((c) => c.expenseDate?.slice(0, 7) === month);

  return (
    <AppShell>
      <PageHeader
        title={t("expenses_title")}
        subtitle={t("expenses_subtitle")}
        actions={
          <div className="flex items-center gap-3">
            <MonthSelector value={month} onChange={setMonth} availableMonths={availableMonths} />
            <button
              disabled={syncing}
              onClick={handleSyncForms}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all select-none ${
                syncing
                  ? "border-stone-200 text-stone-300 bg-stone-50 cursor-not-allowed"
                  : "border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? t("expenses_syncing") : t("expenses_sync_from_forms")}
            </button>
            <button
              onClick={() => setConfirmCleanAll(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
            >
              <TrashIcon />
              {t("expenses_clean_all")}
            </button>
            <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-all select-none ${
              uploading
                ? "border-stone-200 text-stone-300 bg-stone-50 cursor-not-allowed"
                : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
            }`}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {uploading ? t("expenses_reading") : t("expenses_upload_excel")}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
            </label>
            <Button variant="primary" onClick={openNew}>{t("expenses_new_claim")}</Button>
          </div>
        }
      />

      {uploadMsg && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 flex justify-between">
          {uploadMsg}
          <button onClick={() => setUploadMsg(null)}>×</button>
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_FILTER_VALUES.map((s) => (
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
      ) : visibleClaims.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-500 text-sm font-medium">{t("expenses_empty_title")}</p>
          <p className="text-stone-400 text-xs mt-1">{t("expenses_empty_subtitle")}</p>
          <div className="flex gap-3 justify-center mt-4">
            <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 cursor-pointer hover:bg-emerald-100 transition">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {t("expenses_upload_excel")}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
            </label>
            <Button variant="secondary" onClick={openNew}>{t("expenses_new_claim")}</Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("expenses_col_submitted_by")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_category")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_description")}</th>
                <th className="px-4 py-3 text-right">{t("expenses_col_amount")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_submitted")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_expense_date")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_violations")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visibleClaims.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{c.submittedBy || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{categoryLabel(c.category)}</td>
                  <td className="px-4 py-3 text-stone-600 max-w-[200px] truncate">{c.description || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-stone-800">
                    {c.currency} {c.amount.toLocaleString()}
                    {c.extractedAmount !== null && Math.abs(c.extractedAmount - c.amount) > 1 && (
                      <span className="ml-1 text-xs text-amber-600">({t("expenses_receipt_amount")}: {c.extractedAmount.toLocaleString()})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-500">
                    {fmtDate(c.submittedAt)}
                    {fmtTime(c.submittedAt) && <span className="text-stone-400"> {fmtTime(c.submittedAt)}</span>}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{c.expenseDate || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-start rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                      {statusLabel(c.status)}
                    </span>
                    <div className="flex gap-1 mt-1">
                      {c.receiptUrl && (
                        <a href={c.receiptUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline" title={t("expenses_view_receipt")}>📎</a>
                      )}
                      {c.bankAccount && (
                        <span className="text-xs text-stone-400" title={c.bankAccount}>🏦</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.policyViolations.length > 0 ? (
                      <div className="space-y-0.5">
                        {c.policyViolations.map((v) => (
                          <div key={v} className="text-xs text-red-600">{violationLabel(v)}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-green-600">{t("expenses_no_violations")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>{t("expenses_action_edit")}</Button>
                    <Button variant="ghost" size="sm" loading={validating === c.id} onClick={() => handleValidate(c.id)}>{t("expenses_action_validate")}</Button>
                    {(c.status === "submitted" || c.status === "under_review") && (
                      <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("approve"); }}>{t("expenses_action_approve")}</Button>
                    )}
                    {c.status !== "rejected" && c.status !== "paid" && (
                      <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("reject"); }}>{t("expenses_action_reject")}</Button>
                    )}
                    {SHOW_SEND_TO_MF && (c.status === "approved" || c.status === "paid") && !c.mfBillingUrl && (
                      <Button variant="ghost" size="sm" loading={sendingToMF === c.id} onClick={() => handleSendToMF(c.id)}>💴 {t("action_send_to_mf")}</Button>
                    )}
                    {c.mfBillingUrl && (
                      <a href={c.mfBillingUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline whitespace-nowrap self-center" title={t("mf_sent")}>
                        💴 {t("action_view_in_mf")}
                      </a>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>{t("expenses_action_delete")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Claim form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? t("expenses_modal_edit_title") : t("expenses_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("expenses_field_submitted_by")}>
                  <input className={inp} value={form.submittedBy} onChange={(e) => set("submittedBy", e.target.value)} placeholder={t("expenses_field_submitted_by_placeholder")} />
                </Field>
                <Field label={t("expenses_field_email")}>
                  <input className={inp} value={form.submittedByEmail} onChange={(e) => set("submittedByEmail", e.target.value)} placeholder="email@example.com" />
                </Field>
              </div>
              <Field label={t("expenses_field_expense_date")}>
                <input className={inp} type="date" value={form.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
              </Field>
              <Field label={t("expenses_field_category")}>
                <select className={inp} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
              </Field>
              <Field label={t("expenses_field_description")}>
                <textarea className={`${inp} h-16`} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={t("expenses_field_description_placeholder")} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("expenses_field_amount")}>
                  <input className={inp} type="number" value={form.amount} onChange={(e) => set("amount", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label={t("expenses_field_currency")}>
                  <select className={inp} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option>JPY</option><option>USD</option><option>EUR</option>
                  </select>
                </Field>
              </div>
              <Field label={t("expenses_field_payment_method")}>
                <select className={inp} value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
                </select>
              </Field>
              <Field label={t("expenses_field_receipt_url")}>
                <input className={inp} value={form.receiptUrl} onChange={(e) => set("receiptUrl", e.target.value)} placeholder="https://..." />
              </Field>
              <Field label={t("expenses_field_receipt_filename")}>
                <input className={inp} value={form.receiptFilename} onChange={(e) => set("receiptFilename", e.target.value)} placeholder="receipt.pdf" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("expenses_field_project_name")}>
                  <input className={inp} value={form.projectName} onChange={(e) => set("projectName", e.target.value)} />
                </Field>
                <Field label={t("expenses_field_department")}>
                  <input className={inp} value={form.internalDepartment} onChange={(e) => set("internalDepartment", e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("expenses_save")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Approve/Reject modal */}
      {approvingId && approveAction && (() => {
        const approvingClaim = claims.find((c) => c.id === approvingId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
              <h2 className="text-base font-semibold mb-3">
                {approveAction === "approve" ? t("expenses_approve_title") : t("expenses_reject_title")}
              </h2>
              {approvingClaim && (
                <p className="text-xs text-stone-500 mb-4">
                  {approvingClaim.submittedBy} — ¥{approvingClaim.amount.toLocaleString()} ({approvingClaim.expenseDate})
                  <span className="block text-stone-400">{t("expenses_submitted_on")} {fmtDate(approvingClaim.submittedAt)}</span>
                </p>
              )}
              {approveAction === "approve" && approvingClaim?.bankAccount && (
                <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
                  <p className="text-xs font-semibold text-blue-700 mb-1">{t("expenses_bank_transfer")}</p>
                  <pre className="text-xs text-blue-800 whitespace-pre-wrap font-mono leading-relaxed">{approvingClaim.bankAccount}</pre>
                </div>
              )}
              {approveAction === "approve" && approvingClaim && !approvingClaim.bankAccount && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  {t("expenses_no_bank_account")}
                </div>
              )}
              <Field label={t("expenses_approver_name")}>
                <input className={inp} value={actorName} onChange={(e) => setActorName(e.target.value)} />
              </Field>
              <div className="mt-3">
                <Field label={t("expenses_comment")}>
                  <textarea className={`${inp} h-16 mt-1`} value={approveComment} onChange={(e) => setApproveComment(e.target.value)} placeholder={t("expenses_comment_placeholder")} />
                </Field>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <Button variant="secondary" onClick={() => { setApprovingId(null); setApproveAction(null); }}>{t("cancel")}</Button>
                <Button variant={approveAction === "approve" ? "primary" : "danger"} onClick={handleApprove}>
                  {approveAction === "approve" ? t("expenses_action_approve") : t("expenses_action_reject")}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Validation result panel */}
      {validationPanel && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" style={{ marginLeft: "var(--sidebar-w)" }}>
          <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-[1px]" onClick={() => setValidationPanel(null)} />
          <div className="relative bg-white h-full w-full max-w-md shadow-2xl overflow-y-auto flex flex-col">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-stone-100 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-400 mb-0.5">{t("expenses_validation_result")}</p>
                <h2 className="text-base font-semibold text-stone-900">{validationPanel.claim.submittedBy}</h2>
              </div>
              <button onClick={() => setValidationPanel(null)} className="text-stone-400 hover:text-stone-600">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="flex-1 px-6 py-5 space-y-5">
              {/* Risk badge */}
              {(() => {
                const {
                  memberMatched, amountMatchesReceipt, receiptMissing, receiptAccessible, extractedAmount,
                  extractedDate, dateMatchesReceipt, extractedPurpose, purposeMatchesReceipt,
                } = validationPanel.result;
                const extractionFailed = !receiptMissing && receiptAccessible && extractedAmount === null;
                const softMismatch     = (extractedDate !== null && !dateMatchesReceipt) || (extractedPurpose !== null && !purposeMatchesReceipt);
                const fullyVerified    = memberMatched && amountMatchesReceipt && !softMismatch;
                const hardFail         = !memberMatched || (!receiptMissing && receiptAccessible && extractedAmount !== null && !amountMatchesReceipt);
                return (
                  <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${
                    fullyVerified ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : hardFail    ? "bg-red-50 text-red-700 border border-red-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}>
                    {fullyVerified    ? t("expenses_verified")
                    : !memberMatched  ? t("expenses_submitter_not_found")
                    : extractionFailed ? t("expenses_extraction_failed")
                                      : t("expenses_needs_review")}
                  </div>
                );
              })()}

              {/* Stage 1: SharePoint member check */}
              <ValidationStageBlock
                number={1}
                title={t("expenses_stage1_title")}
                subtitle={t("expenses_stage1_subtitle")}
                pass={validationPanel.result.memberMatched}
                warn={false}
                lines={[
                  validationPanel.result.memberMatched
                    ? `✓ "${validationPanel.claim.submittedBy}" ${t("expenses_stage1_found")}`
                    : `✕ "${validationPanel.claim.submittedBy}" ${t("expenses_stage1_not_found")}`,
                  validationPanel.result.contractFileName
                    ? `${t("expenses_stage1_contract")}: ${validationPanel.result.contractFileName}`
                    : "",
                ].filter(Boolean)}
              />

              {/* Stage 2: Receipt match
                  pass = receipt accessible + amount extracted + matches + date/purpose (if extracted) match
                  warn = no receipt, inaccessible, extraction failed, OR date/purpose mismatch (needs human review)
                  fail = extracted amount clearly mismatches submitted amount */}
              <ValidationStageBlock
                number={2}
                title={t("expenses_stage2_title")}
                subtitle={t("expenses_stage2_subtitle")}
                pass={
                  validationPanel.result.receiptAccessible && validationPanel.result.amountMatchesReceipt && validationPanel.result.extractedAmount !== null &&
                  (validationPanel.result.extractedDate === null || validationPanel.result.dateMatchesReceipt) &&
                  (validationPanel.result.extractedPurpose === null || validationPanel.result.purposeMatchesReceipt)
                }
                warn={
                  validationPanel.result.receiptMissing ||
                  !validationPanel.result.receiptAccessible ||
                  (validationPanel.result.receiptAccessible && validationPanel.result.extractedAmount === null) ||
                  (validationPanel.result.extractedDate !== null && !validationPanel.result.dateMatchesReceipt) ||
                  (validationPanel.result.extractedPurpose !== null && !validationPanel.result.purposeMatchesReceipt)
                }
                lines={[
                  validationPanel.result.receiptMissing
                    ? t("expenses_no_receipt")
                    : validationPanel.result.receiptAccessible
                    ? t("expenses_receipt_accessible")
                    : t("expenses_receipt_unreachable"),
                  validationPanel.result.extractedAmount !== null
                    ? `${t("expenses_receipt_amount")}: JPY ${validationPanel.result.extractedAmount.toLocaleString()} ${validationPanel.result.amountMatchesReceipt ? t("expenses_matches_submitted") : `${t("expenses_mismatch_submitted")} JPY ${validationPanel.claim.amount.toLocaleString()}`}`
                    : t("expenses_amount_extract_failed"),
                  validationPanel.result.extractedDate
                    ? `${t("expenses_receipt_date")}: ${validationPanel.result.extractedDate} ${validationPanel.result.dateMatchesReceipt ? t("expenses_matches_submitted") : `${t("expenses_mismatch_submitted")} ${validationPanel.claim.expenseDate}`}`
                    : t("expenses_date_not_found"),
                  validationPanel.result.extractedVendor
                    ? `${t("expenses_vendor")}: ${validationPanel.result.extractedVendor}`
                    : "",
                  validationPanel.result.extractedPurpose
                    ? `${t("expenses_purpose")}: ${validationPanel.result.extractedPurpose} ${validationPanel.result.purposeMatchesReceipt ? t("expenses_matches_submitted") : `${t("expenses_mismatch_submitted")} "${validationPanel.claim.description}"`}`
                    : "",
                  (validationPanel.result as {receiptFetchError?: string}).receiptFetchError
                    ? `${t("expenses_error_label")}: ${(validationPanel.result as {receiptFetchError?: string}).receiptFetchError}`
                    : "",
                ].filter(Boolean)}
                isLast
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-stone-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setValidationPanel(null)}>{t("close")}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmCleanAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold text-stone-900">{t("expenses_clean_all_confirm_title")}</h2>
            <p className="mb-6 text-sm text-stone-500">{t("expenses_clean_all_confirm_body")}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmCleanAll(false)}
                disabled={cleaningAll}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleCleanAll}
                disabled={cleaningAll}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cleaningAll ? t("expenses_clean_all_deleting") : t("expenses_clean_all_confirm_action")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function TrashIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}

const inp = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30";

function ValidationStageBlock({ number, title, subtitle, pass, warn, lines, isLast }: {
  number: number; title: string; subtitle: string;
  pass: boolean; warn: boolean; lines: string[]; isLast?: boolean;
}) {
  const { t } = useLanguage();
  const status = warn ? "warn" : pass ? "pass" : "fail";
  const colors = {
    pass: { card: "bg-emerald-50 border-emerald-200", num: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: "✓", label: t("stage_status_passed") },
    warn: { card: "bg-amber-50 border-amber-200",    num: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",   text: "text-amber-700",   icon: "⚠", label: t("stage_status_review") },
    fail: { card: "bg-red-50 border-red-200",         num: "bg-red-500",     badge: "bg-red-100 text-red-700",       text: "text-red-700",     icon: "✕", label: t("stage_status_failed") },
  }[status];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${colors.num}`}>{number}</div>
        {!isLast && <div className="mt-1 h-full w-px bg-stone-200" />}
      </div>
      <div className={`mb-3 flex-1 rounded-xl border px-4 py-3 ${colors.card}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-stone-800">{title}</p>
            <p className="text-xs text-stone-500">{subtitle}</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors.badge}`}>
            {colors.icon} {colors.label}
          </span>
        </div>
        <div className={`mt-2 space-y-0.5 text-xs leading-relaxed ${colors.text}`}>
          {lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
