"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useNotifications } from "@/lib/notifications";
import type { Proposal, StagedPipelineRecord, ExpenseClaim, OutboundInvoice, InvoiceSubmission } from "@/types";

type ModuleKey = "proposals" | "pipeline_sync" | "expenses" | "outbound_invoices" | "invoices";

const MODULE_LABEL: Record<ModuleKey, string> = {
  proposals: "Proposal",
  pipeline_sync: "Pipeline Sync",
  expenses: "Expense",
  outbound_invoices: "Outbound Invoice",
  invoices: "Invoice",
};

// One shape all five modules' deleted items get normalized into, so the page
// can render/filter/restore them uniformly instead of five parallel branches.
interface ArchivedItem {
  key: string; // `${module}:${id}` — unique across modules since ids aren't
  module: ModuleKey;
  id: string;
  title: string;
  subtitle: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

function toArchivedProposal(p: Proposal): ArchivedItem {
  return {
    key: `proposals:${p.id}`,
    module: "proposals",
    id: p.id,
    title: p.projectName || "(untitled proposal)",
    subtitle: p.clientName ?? "",
    deletedAt: p.deletedAt ?? null,
    deletedBy: p.deletedBy ?? null,
  };
}

function toArchivedPipeline(r: StagedPipelineRecord): ArchivedItem {
  return {
    key: `pipeline_sync:${r.id}`,
    module: "pipeline_sync",
    id: r.id,
    title: r.rawClientName,
    subtitle: r.projectName || "",
    deletedAt: r.deletedAt ?? null,
    deletedBy: r.deletedBy ?? null,
  };
}

function toArchivedExpense(c: ExpenseClaim): ArchivedItem {
  return {
    key: `expenses:${c.id}`,
    module: "expenses",
    id: c.id,
    title: c.description || "(no description)",
    subtitle: `${c.submittedBy} · ${c.currency} ${c.amount.toLocaleString()}`,
    deletedAt: c.deletedAt ?? null,
    deletedBy: c.deletedBy ?? null,
  };
}

function toArchivedOutboundInvoice(inv: OutboundInvoice): ArchivedItem {
  return {
    key: `outbound_invoices:${inv.id}`,
    module: "outbound_invoices",
    id: inv.id,
    title: inv.invoiceNumber || inv.projectName || "(untitled invoice)",
    subtitle: `${inv.clientName} · ${inv.currency} ${inv.total.toLocaleString()}`,
    deletedAt: inv.deletedAt ?? null,
    deletedBy: inv.deletedBy ?? null,
  };
}

function toArchivedInvoiceSubmission(s: InvoiceSubmission): ArchivedItem {
  return {
    key: `invoices:${s.id}`,
    module: "invoices",
    id: s.id,
    title: s.payerName || "(unknown submitter)",
    subtitle: `${s.closingMonth} · ${s.currency ?? "JPY"} ${s.claimedAmountTaxIncluded}`,
    deletedAt: s.deletedAt ?? null,
    deletedBy: s.deletedBy ?? null,
  };
}

const RESTORE_ENDPOINT: Record<ModuleKey, (id: string) => string> = {
  proposals: (id) => `/api/proposals/${id}/restore`,
  pipeline_sync: (id) => `/api/pipeline-sync/${id}/undelete`,
  expenses: (id) => `/api/expenses/${id}/restore`,
  outbound_invoices: (id) => `/api/outbound-invoices/${id}/restore`,
  invoices: (id) => `/api/invoices/${id}/restore`,
};

export default function ArchivesPage() {
  const { notify } = useNotifications();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ModuleKey | "all">("all");
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [proposalsRes, pipelineRes, expensesRes, outboundRes, invoicesRes] = await Promise.all([
        fetch("/api/proposals/deleted"),
        fetch("/api/pipeline-sync/deleted"),
        fetch("/api/expenses/deleted"),
        fetch("/api/outbound-invoices/deleted"),
        fetch("/api/invoices/deleted"),
      ]);
      const [proposalsData, pipelineData, expensesData, outboundData, invoicesData] = await Promise.all([
        proposalsRes.json() as Promise<{ proposals?: Proposal[] }>,
        pipelineRes.json() as Promise<{ records?: StagedPipelineRecord[] }>,
        expensesRes.json() as Promise<{ claims?: ExpenseClaim[] }>,
        outboundRes.json() as Promise<{ invoices?: OutboundInvoice[] }>,
        invoicesRes.json() as Promise<{ submissions?: InvoiceSubmission[] }>,
      ]);

      const all: ArchivedItem[] = [
        ...(proposalsData.proposals ?? []).map(toArchivedProposal),
        ...(pipelineData.records ?? []).map(toArchivedPipeline),
        ...(expensesData.claims ?? []).map(toArchivedExpense),
        ...(outboundData.invoices ?? []).map(toArchivedOutboundInvoice),
        ...(invoicesData.submissions ?? []).map(toArchivedInvoiceSubmission),
      ].sort((a, b) => (a.deletedAt ?? "") < (b.deletedAt ?? "") ? 1 : -1);

      setItems(all);
    } catch {
      setError("Failed to load archived items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function restore(item: ArchivedItem) {
    setRestoringKey(item.key);
    setError(null);
    try {
      const res = await fetch(RESTORE_ENDPOINT[item.module](item.id), { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const message = data.error ?? "Failed to restore item";
        setError(message);
        notify("error", message, "/archives");
        return;
      }
      setItems((prev) => prev.filter((i) => i.key !== item.key));
      notify("success", `Restored "${item.title}"`, "/archives");
    } catch {
      setError("Failed to restore item");
      notify("error", "Failed to restore item");
    } finally {
      setRestoringKey(null);
    }
  }

  const counts = {
    all: items.length,
    proposals: items.filter((i) => i.module === "proposals").length,
    pipeline_sync: items.filter((i) => i.module === "pipeline_sync").length,
    expenses: items.filter((i) => i.module === "expenses").length,
    outbound_invoices: items.filter((i) => i.module === "outbound_invoices").length,
    invoices: items.filter((i) => i.module === "invoices").length,
  };
  const filtered = filter === "all" ? items : items.filter((i) => i.module === filter);

  return (
    <AppShell>
      <PageHeader
        title="Archives"
        subtitle="Deleted items from Proposals, Pipeline Sync, Expenses, Outbound Invoices, and Invoices — restore anything moved here by mistake."
      />

      {error && (
        <div className="mb-4 flex justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "proposals", "pipeline_sync", "expenses", "outbound_invoices", "invoices"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "border-[#1a3d2b] bg-[#1a3d2b] text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
            }`}
          >
            {f === "all" ? "All" : MODULE_LABEL[f]}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter === f ? "bg-white/20" : "bg-stone-100"}`}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-stone-400">Nothing here — deleted items from any module will show up in this list.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
                    {MODULE_LABEL[item.module]}
                  </span>
                </div>
                <p className="mt-1 truncate font-medium text-stone-900">{item.title}</p>
                {item.subtitle && <p className="truncate text-sm text-stone-500">{item.subtitle}</p>}
                <p className="mt-0.5 text-xs text-stone-400">
                  Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "—"}
                  {item.deletedBy ? ` by ${item.deletedBy}` : ""}
                </p>
              </div>
              <Button variant="primary" size="sm" loading={restoringKey === item.key} onClick={() => restore(item)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
