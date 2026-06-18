"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import clsx from "clsx";
import type { ExpenseClaim, ExpenseCategory } from "@/types";

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "travel",   label: "Travel" },
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "meals",    label: "Meals" },
  { value: "office",   label: "Office" },
  { value: "training", label: "Training" },
  { value: "other",    label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-50 text-blue-700",
  under_review: "bg-amber-50 text-amber-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  paid: "bg-violet-50 text-violet-700",
};

type FilterStatus = "all" | "submitted" | "under_review" | "approved" | "rejected" | "paid";

export default function ExpensesPage() {
  const [claims, setClaims]           = useState<ExpenseClaim[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<FilterStatus>("all");
  const [showForm, setShowForm]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [selected, setSelected]       = useState<ExpenseClaim | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing]     = useState(false);

  const [form, setForm] = useState({
    submittedBy: "",
    submittedByEmail: "",
    category: "other" as ExpenseCategory,
    purpose: "",
    amount: "",
    projectName: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter !== "all" ? `?status=${filter}` : "";
    const res = await fetch(`/api/expenses${params}`);
    const data = await res.json() as { claims: ExpenseClaim[] };
    setClaims(data.claims ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) || 0 }),
    });
    setForm({ submittedBy: "", submittedByEmail: "", category: "other", purpose: "", amount: "", projectName: "", notes: "" });
    setShowForm(false);
    setSubmitting(false);
    await load();
  }

  async function review(decision: "approved" | "rejected") {
    if (!selected) return;
    setReviewing(true);
    await fetch("/api/expenses/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, decision, reviewerComment: reviewComment }),
    });
    setSelected(null);
    setReviewComment("");
    setReviewing(false);
    await load();
  }

  const counts = {
    all: claims.length,
    submitted: claims.filter((c) => c.status === "submitted").length,
    under_review: claims.filter((c) => c.status === "under_review").length,
    approved: claims.filter((c) => c.status === "approved").length,
    rejected: claims.filter((c) => c.status === "rejected").length,
  };

  const filtered = filter === "all" ? claims : claims.filter((c) => c.status === filter);
  const totalApproved = claims.filter((c) => c.status === "approved").reduce((s, c) => s + c.amount, 0);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">Expense Claims</h1>
            <p className="mt-1 text-sm text-stone-500">Phase 8 — Employee expense submissions and approval</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-[#1a3d2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3d2b]/90"
          >
            + Submit Expense
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Pending", value: counts.submitted + counts.under_review, color: "text-amber-600" },
            { label: "Approved", value: counts.approved, color: "text-green-600" },
            { label: "Rejected", value: counts.rejected, color: "text-red-600" },
            { label: "Approved Total", value: `¥${totalApproved.toLocaleString()}`, color: "text-violet-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-stone-400">{s.label}</p>
              <p className={clsx("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 border-b border-stone-200">
          {(["all", "submitted", "under_review", "approved", "rejected"] as FilterStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "px-3 py-2 text-xs font-medium border-b-2 transition",
                filter === s ? "border-[#1a3d2b] text-[#1a3d2b]" : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {s === "all" ? "All" : s.replace("_", " ")}
              {s !== "paid" && <span className="ml-1 text-stone-400">({s === "all" ? counts.all : counts[s as keyof typeof counts] ?? 0})</span>}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-sm text-stone-400 py-8 text-center">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-stone-400 py-8 text-center">No expense claims</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-100 shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-400">
                <tr>
                  {["Submitted By", "Category", "Purpose", "Amount", "Project", "Submitted", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-800">{c.submittedBy}</td>
                    <td className="px-4 py-3 text-stone-600 capitalize">{c.category}</td>
                    <td className="px-4 py-3 text-stone-600 max-w-[200px] truncate">{c.purpose}</td>
                    <td className="px-4 py-3 font-mono text-stone-700">¥{c.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-stone-500">{c.projectName ?? "—"}</td>
                    <td className="px-4 py-3 text-stone-500">{c.submittedAt.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium capitalize", STATUS_COLORS[c.status] ?? "bg-stone-100 text-stone-600")}>
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(c.status === "submitted" || c.status === "under_review") && (
                        <button
                          onClick={() => { setSelected(c); setReviewComment(c.reviewerComment ?? ""); }}
                          className="text-xs text-[#1a3d2b] underline hover:no-underline"
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">Submit Expense Claim</h2>
            <form onSubmit={(e) => { void submit(e); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Name *</label>
                  <input required className="input-base" value={form.submittedBy} onChange={(e) => setForm({ ...form, submittedBy: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Email *</label>
                  <input type="email" required className="input-base" value={form.submittedByEmail} onChange={(e) => setForm({ ...form, submittedByEmail: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Category *</label>
                <select required className="input-base" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Purpose *</label>
                <input required className="input-base" placeholder="What was the expense for?" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Amount (¥) *</label>
                  <input type="number" required min={1} className="input-base" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Project</label>
                  <input className="input-base" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Notes</label>
                <textarea rows={2} className="input-base resize-none" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-[#1a3d2b] py-2 text-sm font-medium text-white disabled:opacity-50">
                  {submitting ? "Submitting…" : "Submit"}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-stone-200 py-2 text-sm font-medium text-stone-600">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-stone-900">Review Expense Claim</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">Submitted by</dt><dd className="font-medium">{selected.submittedBy}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Purpose</dt><dd>{selected.purpose}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Amount</dt><dd className="font-mono">¥{selected.amount.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Category</dt><dd className="capitalize">{selected.category}</dd></div>
              {selected.projectName && <div className="flex justify-between"><dt className="text-stone-500">Project</dt><dd>{selected.projectName}</dd></div>}
            </dl>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Comment (optional)</label>
              <textarea rows={3} className="input-base resize-none" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { void review("approved"); }} disabled={reviewing} className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white disabled:opacity-50">
                Approve
              </button>
              <button onClick={() => { void review("rejected"); }} disabled={reviewing} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50">
                Reject
              </button>
              <button onClick={() => setSelected(null)} className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .input-base {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e7e5e4;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          color: #1c1917;
          background: white;
          outline: none;
        }
        .input-base:focus {
          border-color: #1a3d2b;
          box-shadow: 0 0 0 2px rgba(26,61,43,0.1);
        }
      `}</style>
    </AppShell>
  );
}
