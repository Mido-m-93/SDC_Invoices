"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { ExpenseClaim, ExpenseCategory, ExpensePaymentMethod, ExpenseStatus, ExpenseValidationResult } from "@/types";

const CATEGORIES: ExpenseCategory[] = ["transport","accommodation","meals","software","hardware","office_supplies","communication","entertainment","training","other"];
const PAYMENT_METHODS: ExpensePaymentMethod[] = ["company_card","invoice_payment","personal_reimbursement"];
const STATUSES: { value: ExpenseStatus | "all"; label: string }[] = [
  { value: "all",          label: "All / 全て" },
  { value: "submitted",    label: "Submitted / 提出済み" },
  { value: "under_review", label: "Under Review / 審査中" },
  { value: "approved",     label: "Approved / 承認済み" },
  { value: "rejected",     label: "Rejected / 却下" },
  { value: "paid",         label: "Paid / 支払済み" },
];

const STATUS_JA: Record<string, string> = {
  draft:        "下書き",
  submitted:    "提出済み",
  under_review: "審査中",
  approved:     "承認済み",
  rejected:     "却下",
  paid:         "支払済み",
  archived:     "アーカイブ",
};

const VIOLATION_JA: Record<string, string> = {
  MISSING_RECEIPT:                    "領収書なし",
  MISSING_PURPOSE:                    "目的未記入",
  HIGH_AMOUNT_PERSONAL_REIMBURSEMENT: "高額個人立替",
  REQUIRES_MANAGEMENT_APPROVAL:       "管理者承認必要",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
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

const RISK_COLORS = { OK: "text-green-600", NEEDS_REVIEW: "text-amber-600", BLOCKED: "text-red-600" };

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
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? "/api/expenses" : `/api/expenses?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json() as { claims: ExpenseClaim[] };
      setClaims(data.claims ?? []);
    } catch { setError("Failed to load expense claims"); }
    finally { setLoading(false); }
  }, [statusFilter]);

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
        setError(data.error ?? "Upload failed");
      } else {
        setUploadMsg(`✓ ${data.count} expense claim${data.count === 1 ? "" : "s"} imported from "${file.name}"`);
        load();
      }
    } catch {
      setError("Upload failed — check the file format");
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
    } catch { setError("Failed to save expense claim"); }
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
    } catch { setError("Validation failed"); }
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
    } catch { setError("Failed to update status"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense claim?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    load();
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
        setError(data.error ?? "Sync failed");
      } else {
        const n = data.count ?? data.synced ?? 0;
        const total = data.totalRows ?? n;
        const skipped = data.skipped ?? 0;
        const skipNote = skipped > 0 ? ` (${skipped} rows skipped — missing name field)` : "";
        setUploadMsg(`✓ ${n} of ${total} expense claims synced from Microsoft Forms${skipNote}`);
        load();
      }
    } catch {
      setError("Sync failed — check server logs");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Expense Claims / 経費精算"
        subtitle="Submit and review expense reimbursement requests / 経費の提出・審査"
        actions={
          <div className="flex items-center gap-3">
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
              {syncing ? "Syncing…" : "Sync from Forms"}
            </button>
            <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-all select-none ${
              uploading
                ? "border-stone-200 text-stone-300 bg-stone-50 cursor-not-allowed"
                : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
            }`}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {uploading ? "Reading…" : "Upload Excel"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
            </label>
            <Button variant="primary" onClick={openNew}>+ New Claim</Button>
          </div>
        }
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
        ⚠ Expense claims require receipt documentation. Reimbursements are processed separately — this tool only validates and records approvals.
        <span className="block text-xs mt-0.5 text-amber-600">経費申請には領収書が必要です。支払処理は別途行われます。このツールは検証と承認記録のみを行います。</span>
      </div>

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
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${statusFilter === s.value ? "bg-[#1a3d2b] text-white border-[#1a3d2b]" : "text-stone-500 border-stone-200 hover:border-stone-400"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : claims.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-500 text-sm font-medium">No expense claims found.</p>
          <p className="text-stone-400 text-xs mt-1">Upload a Microsoft Forms Excel export, or add a claim manually.</p>
          <div className="flex gap-3 justify-center mt-4">
            <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 cursor-pointer hover:bg-emerald-100 transition">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
            </label>
            <Button variant="secondary" onClick={openNew}>+ New Claim</Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Submitted By<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">提出者</span></th>
                <th className="px-4 py-3 text-left">Category<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">カテゴリ</span></th>
                <th className="px-4 py-3 text-left">Description<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">説明</span></th>
                <th className="px-4 py-3 text-right">Amount<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">金額</span></th>
                <th className="px-4 py-3 text-left">Submitted<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">提出日</span></th>
                <th className="px-4 py-3 text-left">Expense Date<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">経費日</span></th>
                <th className="px-4 py-3 text-left">Status<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">ステータス</span></th>
                <th className="px-4 py-3 text-left">Violations<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">違反</span></th>
                <th className="px-4 py-3 text-left">Actions<span className="block normal-case tracking-normal font-normal text-[10px] text-stone-400">操作</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {claims.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{c.submittedBy || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 capitalize">{c.category.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-stone-600 max-w-[200px] truncate">{c.description || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-stone-800">
                    {c.currency} {c.amount.toLocaleString()}
                    {c.extractedAmount !== null && Math.abs(c.extractedAmount - c.amount) > 1 && (
                      <span className="ml-1 text-xs text-amber-600">(receipt: {c.extractedAmount.toLocaleString()})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{fmtDate(c.submittedAt)}</td>
                  <td className="px-4 py-3 text-stone-500">{c.expenseDate || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex flex-col items-start rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                      <span>{c.status.replace(/_/g, " ")}</span>
                      <span className="text-[10px] font-normal opacity-75">{STATUS_JA[c.status] ?? ""}</span>
                    </span>
                    <div className="flex gap-1 mt-1">
                      {c.receiptUrl && (
                        <a href={c.receiptUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline" title="View receipt">📎</a>
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
                          <div key={v} className="text-xs text-red-600">
                            {v}<span className="text-red-400 ml-1">({VIOLATION_JA[v] ?? v})</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-green-600">None / なし</span>
                    )}
                  </td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>Edit / 編集</Button>
                    <Button variant="ghost" size="sm" loading={validating === c.id} onClick={() => handleValidate(c.id)}>Validate / 検証</Button>
                    {(c.status === "submitted" || c.status === "under_review") && (
                      <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("approve"); }}>Approve / 承認</Button>
                    )}
                    {c.status !== "rejected" && c.status !== "paid" && (
                      <Button variant="ghost" size="sm" onClick={() => { setApprovingId(c.id); setApproveAction("reject"); }}>Reject / 却下</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>Delete / 削除</Button>
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
              <h2 className="text-base font-semibold">{editing ? "Edit Expense Claim / 経費申請を編集" : "New Expense Claim / 新規経費申請"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Submitted By * / 提出者">
                  <input className={inp} value={form.submittedBy} onChange={(e) => set("submittedBy", e.target.value)} placeholder="Name / 名前" />
                </Field>
                <Field label="Email / メール">
                  <input className={inp} value={form.submittedByEmail} onChange={(e) => set("submittedByEmail", e.target.value)} placeholder="email@example.com" />
                </Field>
              </div>
              <Field label="Expense Date * / 経費日">
                <input className={inp} type="date" value={form.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
              </Field>
              <Field label="Category * / カテゴリ">
                <select className={inp} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </Field>
              <Field label="Description * / 説明">
                <textarea className={`${inp} h-16`} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Purpose of expense / 経費の目的..." />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Amount * / 金額">
                  <input className={inp} type="number" value={form.amount} onChange={(e) => set("amount", parseFloat(e.target.value) || 0)} />
                </Field>
                <Field label="Currency / 通貨">
                  <select className={inp} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option>JPY</option><option>USD</option><option>EUR</option>
                  </select>
                </Field>
              </div>
              <Field label="Payment Method * / 支払方法">
                <select className={inp} value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                </select>
              </Field>
              <Field label="Receipt URL / 領収書URL">
                <input className={inp} value={form.receiptUrl} onChange={(e) => set("receiptUrl", e.target.value)} placeholder="https://..." />
              </Field>
              <Field label="Receipt Filename / 領収書ファイル名">
                <input className={inp} value={form.receiptFilename} onChange={(e) => set("receiptFilename", e.target.value)} placeholder="receipt.pdf" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Project Name / プロジェクト">
                  <input className={inp} value={form.projectName} onChange={(e) => set("projectName", e.target.value)} />
                </Field>
                <Field label="Department / 部署">
                  <input className={inp} value={form.internalDepartment} onChange={(e) => set("internalDepartment", e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel / キャンセル</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>Save / 保存</Button>
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
              <h2 className="text-base font-semibold mb-0.5 capitalize">
                {approveAction === "approve" ? "Approve Expense Claim" : "Reject Expense Claim"}
              </h2>
              <p className="text-xs text-stone-400 mb-3">{approveAction === "approve" ? "経費申請を承認" : "経費申請を却下"}</p>
              {approvingClaim && (
                <p className="text-xs text-stone-500 mb-4">
                  {approvingClaim.submittedBy} — ¥{approvingClaim.amount.toLocaleString()} ({approvingClaim.expenseDate})
                  <span className="block text-stone-400">提出日 {fmtDate(approvingClaim.submittedAt)}</span>
                </p>
              )}
              {approveAction === "approve" && approvingClaim?.bankAccount && (
                <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
                  <p className="text-xs font-semibold text-blue-700 mb-1">振込先 / Bank Transfer</p>
                  <pre className="text-xs text-blue-800 whitespace-pre-wrap font-mono leading-relaxed">{approvingClaim.bankAccount}</pre>
                </div>
              )}
              {approveAction === "approve" && approvingClaim && !approvingClaim.bankAccount && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  ⚠ 銀行口座情報がありません — 振込先を別途確認してください
                </div>
              )}
              <Field label="Your Name * / 承認者名">
                <input className={inp} value={actorName} onChange={(e) => setActorName(e.target.value)} />
              </Field>
              <div className="mt-3">
                <Field label="Comment / コメント">
                  <textarea className={`${inp} h-16 mt-1`} value={approveComment} onChange={(e) => setApproveComment(e.target.value)} placeholder="Optional reviewer comment / 任意のコメント..." />
                </Field>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <Button variant="secondary" onClick={() => { setApprovingId(null); setApproveAction(null); }}>Cancel / キャンセル</Button>
                <Button variant={approveAction === "approve" ? "primary" : "danger"} onClick={handleApprove}>
                  {approveAction === "approve" ? "Approve / 承認" : "Reject / 却下"}
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
                <p className="text-xs text-stone-400 mb-0.5">Validation Result</p>
                <h2 className="text-base font-semibold text-stone-900">{validationPanel.claim.submittedBy}</h2>
              </div>
              <button onClick={() => setValidationPanel(null)} className="text-stone-400 hover:text-stone-600">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="flex-1 px-6 py-5 space-y-5">
              {/* Risk badge */}
              {(() => {
                const { memberMatched, amountMatchesReceipt, receiptMissing, receiptAccessible, extractedAmount } = validationPanel.result;
                const extractionFailed = !receiptMissing && receiptAccessible && extractedAmount === null;
                const fullyVerified    = memberMatched && amountMatchesReceipt;
                const hardFail         = !memberMatched || (!receiptMissing && receiptAccessible && extractedAmount !== null && !amountMatchesReceipt);
                return (
                  <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${
                    fullyVerified ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : hardFail    ? "bg-red-50 text-red-700 border border-red-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}>
                    {fullyVerified    ? "✓ Claim verified — member registered and receipt matches"
                    : !memberMatched  ? "✕ Submitter not found in SharePoint — cannot approve"
                    : extractionFailed ? "⚠ Member registered — receipt unreadable, manual review needed"
                                      : "⚠ Member registered — receipt needs review"}
                  </div>
                );
              })()}

              {/* Stage 1: SharePoint member check */}
              <ValidationStageBlock
                number={1}
                title="SharePoint Member Check"
                subtitle="Submitter is a registered member in SharePoint"
                pass={validationPanel.result.memberMatched}
                warn={false}
                lines={[
                  validationPanel.result.memberMatched
                    ? `✓ "${validationPanel.claim.submittedBy}" found in SharePoint contracts`
                    : `✕ "${validationPanel.claim.submittedBy}" not found in SharePoint contracts`,
                  validationPanel.result.contractFileName
                    ? `Contract: ${validationPanel.result.contractFileName}`
                    : "",
                ].filter(Boolean)}
              />

              {/* Stage 2: Receipt match
                  pass = receipt accessible + amount extracted + matches
                  warn = no receipt, inaccessible, OR accessible but extraction failed (needs human review)
                  fail = extracted amount clearly mismatches submitted amount */}
              <ValidationStageBlock
                number={2}
                title="Receipt vs Submission"
                subtitle="AI-extracted receipt data matches what the submitter provided"
                pass={validationPanel.result.receiptAccessible && validationPanel.result.amountMatchesReceipt && validationPanel.result.extractedAmount !== null}
                warn={
                  validationPanel.result.receiptMissing ||
                  !validationPanel.result.receiptAccessible ||
                  (validationPanel.result.receiptAccessible && validationPanel.result.extractedAmount === null)
                }
                lines={[
                  validationPanel.result.receiptMissing
                    ? "✕ No receipt attached"
                    : validationPanel.result.receiptAccessible
                    ? "✓ Receipt accessible"
                    : "✕ Receipt URL not reachable",
                  validationPanel.result.extractedAmount !== null
                    ? `Receipt amount: JPY ${validationPanel.result.extractedAmount.toLocaleString()} ${validationPanel.result.amountMatchesReceipt ? "✓ matches submitted" : `✗ submitted was JPY ${validationPanel.claim.amount.toLocaleString()}`}`
                    : "Amount: could not extract from receipt",
                  validationPanel.result.extractedDate
                    ? `Receipt date: ${validationPanel.result.extractedDate} ✓`
                    : "Date: not found in receipt",
                  validationPanel.result.extractedVendor
                    ? `Vendor: ${validationPanel.result.extractedVendor}`
                    : "",
                  validationPanel.result.extractedPurpose
                    ? `Purpose: ${validationPanel.result.extractedPurpose}`
                    : "",
                  !validationPanel.result.receiptAccessible && (validationPanel.result as {receiptFetchError?: string}).receiptFetchError
                    ? `Error: ${(validationPanel.result as {receiptFetchError?: string}).receiptFetchError}`
                    : "",
                ].filter(Boolean)}
                isLast
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-stone-100 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={() => setValidationPanel(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const inp = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30";

function ValidationStageBlock({ number, title, subtitle, pass, warn, lines, isLast }: {
  number: number; title: string; subtitle: string;
  pass: boolean; warn: boolean; lines: string[]; isLast?: boolean;
}) {
  const status = warn ? "warn" : pass ? "pass" : "fail";
  const colors = {
    pass: { card: "bg-emerald-50 border-emerald-200", num: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: "✓", label: "Passed" },
    warn: { card: "bg-amber-50 border-amber-200",    num: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",   text: "text-amber-700",   icon: "⚠", label: "Warning" },
    fail: { card: "bg-red-50 border-red-200",         num: "bg-red-500",     badge: "bg-red-100 text-red-700",       text: "text-red-700",     icon: "✕", label: "Failed" },
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
