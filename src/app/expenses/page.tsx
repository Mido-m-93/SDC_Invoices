"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { ExpenseClaim, ExpenseCategory, ExpensePaymentMethod, ExpenseStatus } from "@/types";
import ExpenseValidationStages from "@/components/expense/ExpenseValidationStages";
import { useLanguage, type TranslationKey } from "@/translations";

const CATEGORIES: ExpenseCategory[] = ["transport","accommodation","meals","software","hardware","office_supplies","communication","entertainment","training","other"];
const PAYMENT_METHODS: ExpensePaymentMethod[] = ["company_card","invoice_payment","personal_reimbursement"];
const STATUSES: { value: ExpenseStatus | "all"; labelKey: string }[] = [
  { value: "all", labelKey: "expenses_status_all" },
  { value: "submitted", labelKey: "expenses_status_submitted" },
  { value: "under_review", labelKey: "expenses_status_under_review" },
  { value: "approved", labelKey: "expenses_status_approved" },
  { value: "rejected", labelKey: "expenses_status_rejected" },
  { value: "paid", labelKey: "expenses_status_paid" },
];

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  draft: "bg-stone-100 text-stone-500",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  paid: "bg-emerald-100 text-emerald-700",
  archived: "bg-stone-100 text-stone-400",
};

const RISK_COLORS = { OK: "text-green-600", NEEDS_REVIEW: "text-amber-600", BLOCKED: "text-red-600" };

const VIOLATION_LABEL_KEYS: Record<string, string> = {
  MISSING_RECEIPT:                    "expenses_violation_missing_receipt",
  MISSING_PURPOSE:                    "expenses_violation_missing_purpose",
  HIGH_AMOUNT_PERSONAL_REIMBURSEMENT: "expenses_violation_high_amount_personal",
  REQUIRES_MANAGEMENT_APPROVAL:       "expenses_violation_requires_mgmt_approval",
  NOT_REGISTERED_MEMBER:              "expenses_violation_not_registered_member",
  AMOUNT_MISMATCH:                    "expenses_violation_amount_mismatch",
  DATE_MISMATCH:                      "expenses_violation_date_mismatch",
  PURPOSE_UNCLEAR:                    "expenses_violation_purpose_unclear",
  CATEGORY_MISMATCH:                  "expenses_violation_category_mismatch",
  AMOUNT_SUSPICIOUS:                  "expenses_violation_amount_suspicious",
};

const EMPTY_FORM: Omit<ExpenseClaim, "id" | "createdAt" | "updatedAt" | "status" | "reviewerComment" | "reviewedBy" | "reviewedAt" | "approvedBy" | "approvedAt" | "paidAt" | "extractedAmount" | "extractedDate" | "extractedVendor" | "extractedRecipient" | "extractedPurpose" | "policyViolations" | "submittedAt"> = {
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Stores the raw key + vars rather than a pre-rendered string, so the
  // message re-translates live if the user switches language afterward
  // instead of staying frozen in whatever language was active when it fired.
  const [uploadNotice, setUploadNotice] = useState<{ key: TranslationKey; vars: Record<string, string | number> } | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseClaim | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveAction, setApproveAction] = useState<"approve" | "reject" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [actorName, setActorName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? "/api/expenses" : `/api/expenses?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json() as { claims: ExpenseClaim[] };
      setClaims(data.claims ?? []);
    } catch { setError(t("expenses_load_error")); }
    finally { setLoading(false); }
  }, [statusFilter, t]);

  useEffect(() => {
    // Auto-sync from Forms on mount, then load claims
    fetch("/api/expenses/sync-forms", { method: "POST" })
      .then((r) => r.json())
      .then((d: { imported?: number }) => {
        if ((d.imported ?? 0) > 0) setUploadNotice({ key: "expenses_sync_message", vars: { count: d.imported ?? 0 } });
      })
      .catch(() => { /* Graph not configured — silent fail, manual upload still works */ })
      .finally(() => load());
  }, [load, t]);

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setError(null);
    setUploadNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res  = await fetch("/api/expenses/upload", { method: "POST", body });
      const data = await res.json() as { count?: number; error?: string; detectedHeaders?: string[] };
      if (!res.ok) {
        setError(data.error ?? t("expenses_upload_error_generic"));
      } else {
        setUploadNotice({ key: "expenses_upload_success", vars: { count: data.count ?? 0, filename: file.name } });
        load();
      }
    } catch {
      setError(t("expenses_upload_error_format"));
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
    } catch { setError(t("expenses_save_error")); }
    finally { setSaving(false); }
  }

  async function handleValidate(id: string) {
    setValidating(id);
    try {
      await fetch(`/api/expenses/${id}/validate`, { method: "POST" });
      load();
    } catch { setError(t("expenses_validate_error")); }
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
    } catch { setError(t("expenses_approve_error")); }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("expenses_delete_confirm"))) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    load();
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    setDeletingSelected(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => fetch(`/api/expenses/${id}`, { method: "DELETE" })));
      setClaims((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (e) { setError(String(e)); }
    finally { setDeletingSelected(false); }
  }

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <PageHeader
        title={t("expenses_title")}
        subtitle={t("expenses_subtitle")}
        actions={
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deletingSelected ? t("expenses_deleting") : t("expenses_delete_selected", { count: selectedIds.size })}
              </button>
            )}
<label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-all select-none ${
              uploading
                ? "border-stone-200 text-stone-300 bg-stone-50 cursor-not-allowed"
                : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
            }`}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {uploading ? t("expenses_uploading") : t("expenses_upload_excel")}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
            </label>
            <Button variant="primary" onClick={openNew}>{t("expenses_new_claim")}</Button>
          </div>
        }
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
        {t("expenses_notice_no_payment")}
      </div>

      {uploadNotice && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 flex justify-between">
          {t(uploadNotice.key, uploadNotice.vars)}
          <button onClick={() => setUploadNotice(null)}>×</button>
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
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => { setStatusFilter(s.value); setSelectedIds(new Set()); }}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${statusFilter === s.value ? "bg-[#1a3d2b] text-white border-[#1a3d2b]" : "text-stone-500 border-stone-200 hover:border-stone-400"}`}
          >
            {t(s.labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : claims.length === 0 ? (
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
                <th className="w-10 px-3 py-3">
                  <input type="checkbox"
                    checked={claims.length > 0 && claims.every((c) => selectedIds.has(c.id))}
                    onChange={(e) => setSelectedIds(() => {
                      const next = new Set<string>();
                      if (e.target.checked) claims.forEach((c) => next.add(c.id));
                      return next;
                    })} />
                </th>
                <th className="px-4 py-3 text-left">{t("expenses_col_submitted_by")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_description")}</th>
                <th className="px-4 py-3 text-right">{t("expenses_col_amount")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_date")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_submitted_date")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_violations")}</th>
                <th className="px-4 py-3 text-left">{t("expenses_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {claims.map((c) => {
                const isExpanded = expandedId === c.id;
                const amountOk = c.extractedAmount === null || Math.abs(c.extractedAmount - c.amount) <= 1;
                return (
                  <>
                    <tr key={c.id} className={selectedIds.has(c.id) ? "bg-red-50/40" : "hover:bg-stone-50"}>
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" checked={selectedIds.has(c.id)}
                          onChange={(e) => setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            return next;
                          })} />
                      </td>
                      <td className="px-4 py-3 font-medium text-stone-800">{c.submittedBy || t("none")}</td>
                      <td className="px-4 py-3 text-stone-600 max-w-[200px] truncate">{c.description || t("none")}</td>
                      <td className="px-4 py-3 text-right font-mono text-stone-800">
                        {c.currency} {c.amount.toLocaleString()}
                        {c.extractedAmount !== null && !amountOk && (
                          <span className="ml-1 text-xs text-red-500">(receipt: {c.extractedAmount.toLocaleString()})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-500">{c.expenseDate || t("none")}</td>
                      <td className="px-4 py-3 text-stone-500">{c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : t("none")}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                          {c.status.replace(/_/g, " ")}
                        </span>
                        <div className="flex gap-1 mt-1">
                          {c.receiptUrl && (
                            <a href={c.receiptUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline" title={t("expenses_view_receipt")}>📎</a>
                          )}
                          {c.bankAccount && (
                            <span className="text-xs text-stone-400" title={c.bankAccount}>🏦</span>
                          )}
                          {c.mfBillingUrl && (
                            <a href={c.mfBillingUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline" title={t("expenses_view_money_forward")}>💴</a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.policyViolations.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {c.policyViolations.map((v) => (
                              <span key={v} className={`text-xs font-medium ${v === "NOT_REGISTERED_MEMBER" ? "text-orange-600" : "text-red-600"}`}>
                                {VIOLATION_LABEL_KEYS[v] ? t(VIOLATION_LABEL_KEYS[v] as Parameters<typeof t>[0]) : v}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-green-600">{t("expenses_no_violations")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 flex gap-1 flex-wrap">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : c.id)}
                          title={t("expenses_show_stages")}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
                            isExpanded
                              ? "border-stone-400 bg-stone-200 text-stone-700"
                              : "border-stone-300 bg-stone-100 text-stone-600 hover:border-stone-400 hover:bg-stone-200"
                          }`}
                        >
                          <svg className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          {t("expenses_btn_stages")}
                        </button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>{t("expenses_btn_edit")}</Button>
                        <Button variant="ghost" size="sm" loading={validating === c.id} onClick={() => handleValidate(c.id)}>{t("expenses_btn_validate")}</Button>
                        {(c.status === "submitted" || c.status === "under_review") && (
                          <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("approve"); }}>{t("expenses_btn_approve")}</Button>
                        )}
                        {c.status !== "rejected" && c.status !== "paid" && (
                          <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("reject"); }}>{t("expenses_btn_reject")}</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>{t("expenses_btn_delete")}</Button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${c.id}-detail`} className="bg-stone-50/70">
                        <td colSpan={9} className="px-6 py-5">
                          <ExpenseValidationStages claim={c} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
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
                  <input className={inp} value={form.submittedBy} onChange={(e) => set("submittedBy", e.target.value)} placeholder={t("expenses_field_name_placeholder")} />
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
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
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
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
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
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("expenses_save_claim")}</Button>
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
              <h2 className="text-base font-semibold mb-1 capitalize">
                {t("expenses_approve_modal_title", { action: approveAction === "approve" ? t("expenses_approve_action_approve") : t("expenses_approve_action_reject") })}
              </h2>
              {approvingClaim && (
                <p className="text-xs text-stone-500 mb-4">
                  {t("expenses_approve_summary_line", {
                    submittedBy: approvingClaim.submittedBy,
                    amount: approvingClaim.amount.toLocaleString(),
                    expenseDate: approvingClaim.expenseDate,
                  })}
                </p>
              )}
              {approveAction === "approve" && approvingClaim?.bankAccount && (
                <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
                  <p className="text-xs font-semibold text-blue-700 mb-1">{t("expenses_bank_transfer_label")}</p>
                  <pre className="text-xs text-blue-800 whitespace-pre-wrap font-mono leading-relaxed">{approvingClaim.bankAccount}</pre>
                </div>
              )}
              {approveAction === "approve" && approvingClaim && !approvingClaim.bankAccount && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  {t("expenses_no_bank_account_warning")}
                </div>
              )}
              <Field label={t("expenses_field_your_name")}>
                <input className={inp} value={actorName} onChange={(e) => setActorName(e.target.value)} />
              </Field>
              <div className="mt-3">
                <Field label={t("expenses_field_comment")}>
                  <textarea className={`${inp} h-16 mt-1`} value={approveComment} onChange={(e) => setApproveComment(e.target.value)} placeholder={t("expenses_field_comment_placeholder")} />
                </Field>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <Button variant="secondary" onClick={() => { setApprovingId(null); setApproveAction(null); }}>{t("cancel")}</Button>
                <Button variant={approveAction === "approve" ? "primary" : "danger"} onClick={handleApprove}>{approveAction === "approve" ? t("expenses_btn_approve") : t("expenses_btn_reject")}</Button>
              </div>
            </div>
          </div>
        );
      })()}
    </AppShell>
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

