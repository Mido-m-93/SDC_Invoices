"use client";

import { useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useNotifications } from "@/lib/notifications";
import { useLanguage, type TranslationKey } from "@/translations";
import { useTableControls } from "@/lib/hooks/useTableControls";
import { TableFooter, SelectAllCheckbox, RowCheckbox } from "@/components/ui/TableControls";
import type { Proposal, Budget, StagedPipelineRecord, ExpenseClaim, OutboundInvoice, InvoiceSubmission, ProcessingRun, Contract } from "@/types";

interface ArchivedAppUser {
  id: string;
  email: string;
  archivedAt: string | null;
  archivedBy: string | null;
}

type ModuleKey = "proposals" | "budgets" | "contracts" | "pipeline_sync" | "expenses" | "outbound_invoices" | "invoices" | "logs" | "users";

const MODULE_LABEL_KEY: Record<ModuleKey, TranslationKey> = {
  proposals: "archives_module_proposals",
  budgets: "archives_module_budgets",
  contracts: "archives_module_contracts",
  pipeline_sync: "archives_module_pipeline_sync",
  expenses: "archives_module_expenses",
  outbound_invoices: "archives_module_outbound_invoices",
  invoices: "archives_module_invoices",
  logs: "archives_module_logs",
  users: "archives_module_users",
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

type Translate = (key: TranslationKey) => string;

function toArchivedProposal(p: Proposal, t: Translate): ArchivedItem {
  return {
    key: `proposals:${p.id}`,
    module: "proposals",
    id: p.id,
    title: p.projectName || t("archives_untitled_proposal"),
    subtitle: p.clientName ?? "",
    deletedAt: p.deletedAt ?? null,
    deletedBy: p.deletedBy ?? null,
  };
}

function toArchivedBudget(b: Budget, t: Translate): ArchivedItem {
  return {
    key: `budgets:${b.id}`,
    module: "budgets",
    id: b.id,
    title: b.projectName || t("archives_untitled_budget"),
    subtitle: b.clientName ?? "",
    deletedAt: b.deletedAt ?? null,
    deletedBy: b.deletedBy ?? null,
  };
}

function toArchivedContract(c: Contract, t: Translate): ArchivedItem {
  return {
    key: `contracts:${c.id}`,
    module: "contracts",
    id: c.id,
    title: c.clientName || c.projectName || t("archives_untitled_contract"),
    subtitle: c.projectName && c.clientName ? c.projectName : "",
    deletedAt: c.deletedAt ?? null,
    deletedBy: c.deletedBy ?? null,
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

function toArchivedExpense(c: ExpenseClaim, t: Translate): ArchivedItem {
  return {
    key: `expenses:${c.id}`,
    module: "expenses",
    id: c.id,
    title: c.description || t("archives_no_description"),
    subtitle: `${c.submittedBy} · ${c.currency} ${c.amount.toLocaleString()}`,
    deletedAt: c.deletedAt ?? null,
    deletedBy: c.deletedBy ?? null,
  };
}

function toArchivedOutboundInvoice(inv: OutboundInvoice, t: Translate): ArchivedItem {
  return {
    key: `outbound_invoices:${inv.id}`,
    module: "outbound_invoices",
    id: inv.id,
    title: inv.invoiceNumber || inv.projectName || t("archives_untitled_invoice"),
    subtitle: `${inv.clientName} · ${inv.currency} ${inv.total.toLocaleString()}`,
    deletedAt: inv.deletedAt ?? null,
    deletedBy: inv.deletedBy ?? null,
  };
}

function toArchivedInvoiceSubmission(s: InvoiceSubmission, t: Translate): ArchivedItem {
  return {
    key: `invoices:${s.id}`,
    module: "invoices",
    id: s.id,
    title: s.payerName || t("archives_unknown_submitter"),
    subtitle: `${s.closingMonth} · ${s.currency ?? "JPY"} ${s.claimedAmountTaxIncluded}`,
    deletedAt: s.deletedAt ?? null,
    deletedBy: s.deletedBy ?? null,
  };
}

function toArchivedRun(r: ProcessingRun, t: Translate): ArchivedItem {
  return {
    key: `logs:${r.id}`,
    module: "logs",
    id: r.id,
    title: t("archives_run_label").replace("{id}", r.id),
    subtitle: `${r.month} · ${r.status} · ${r.totalRows} row${r.totalRows === 1 ? "" : "s"}`,
    deletedAt: r.deletedAt ?? null,
    deletedBy: r.deletedBy ?? null,
  };
}

function toArchivedUser(u: ArchivedAppUser, t: Translate): ArchivedItem {
  return {
    key: `users:${u.id}`,
    module: "users",
    id: u.id,
    title: u.email || t("archives_unknown_user"),
    subtitle: "",
    deletedAt: u.archivedAt,
    deletedBy: u.archivedBy,
  };
}

const archivedItemKey = (item: ArchivedItem) => item.key;

const RESTORE_ENDPOINT: Record<ModuleKey, (id: string) => string> = {
  proposals: (id) => `/api/proposals/${id}/restore`,
  budgets: (id) => `/api/budgets/${id}/restore`,
  contracts: (id) => `/api/contracts/${id}/restore`,
  pipeline_sync: (id) => `/api/pipeline-sync/${id}/undelete`,
  expenses: (id) => `/api/expenses/${id}/restore`,
  outbound_invoices: (id) => `/api/outbound-invoices/${id}/restore`,
  invoices: (id) => `/api/invoices/${id}/restore`,
  logs: (id) => `/api/runs/${id}/restore`,
  users: (id) => `/api/users/${id}/restore`,
};

export default function ArchivesPage() {
  const { t } = useLanguage();
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
      const [proposalsRes, budgetsRes, contractsRes, pipelineRes, expensesRes, outboundRes, invoicesRes, logsRes, usersRes] = await Promise.all([
        fetch("/api/proposals/deleted"),
        fetch("/api/budgets/deleted"),
        fetch("/api/contracts/deleted"),
        fetch("/api/pipeline-sync/deleted"),
        fetch("/api/expenses/deleted"),
        fetch("/api/outbound-invoices/deleted"),
        fetch("/api/invoices/deleted"),
        fetch("/api/runs/deleted"),
        fetch("/api/users/deleted"),
      ]);
      const [proposalsData, budgetsData, contractsData, pipelineData, expensesData, outboundData, invoicesData, logsData, usersData] = await Promise.all([
        proposalsRes.json() as Promise<{ proposals?: Proposal[] }>,
        budgetsRes.json() as Promise<{ budgets?: Budget[] }>,
        contractsRes.json() as Promise<{ contracts?: Contract[] }>,
        pipelineRes.json() as Promise<{ records?: StagedPipelineRecord[] }>,
        expensesRes.json() as Promise<{ claims?: ExpenseClaim[] }>,
        outboundRes.json() as Promise<{ invoices?: OutboundInvoice[] }>,
        invoicesRes.json() as Promise<{ submissions?: InvoiceSubmission[] }>,
        logsRes.json() as Promise<{ runs?: ProcessingRun[] }>,
        usersRes.json() as Promise<{ users?: ArchivedAppUser[] }>,
      ]);

      const all: ArchivedItem[] = [
        ...(proposalsData.proposals ?? []).map((p) => toArchivedProposal(p, t)),
        ...(budgetsData.budgets ?? []).map((b) => toArchivedBudget(b, t)),
        ...(contractsData.contracts ?? []).map((c) => toArchivedContract(c, t)),
        ...(pipelineData.records ?? []).map(toArchivedPipeline),
        ...(expensesData.claims ?? []).map((c) => toArchivedExpense(c, t)),
        ...(outboundData.invoices ?? []).map((inv) => toArchivedOutboundInvoice(inv, t)),
        ...(invoicesData.submissions ?? []).map((s) => toArchivedInvoiceSubmission(s, t)),
        ...(logsData.runs ?? []).map((r) => toArchivedRun(r, t)),
        ...(usersData.users ?? []).map((u) => toArchivedUser(u, t)),
      ].sort((a, b) => (a.deletedAt ?? "") < (b.deletedAt ?? "") ? 1 : -1);

      setItems(all);
    } catch {
      setError(t("archives_error_load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function restore(item: ArchivedItem) {
    setRestoringKey(item.key);
    setError(null);
    try {
      const res = await fetch(RESTORE_ENDPOINT[item.module](item.id), { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const message = data.error ?? t("archives_error_restore");
        setError(message);
        notify("error", message, "/archives");
        return;
      }
      setItems((prev) => prev.filter((i) => i.key !== item.key));
      notify("success", t("archives_restored_toast").replace("{title}", item.title), "/archives");
    } catch {
      setError(t("archives_error_restore"));
      notify("error", t("archives_error_restore"), "/archives");
    } finally {
      setRestoringKey(null);
    }
  }

  const counts = {
    all: items.length,
    proposals: items.filter((i) => i.module === "proposals").length,
    budgets: items.filter((i) => i.module === "budgets").length,
    contracts: items.filter((i) => i.module === "contracts").length,
    pipeline_sync: items.filter((i) => i.module === "pipeline_sync").length,
    expenses: items.filter((i) => i.module === "expenses").length,
    outbound_invoices: items.filter((i) => i.module === "outbound_invoices").length,
    invoices: items.filter((i) => i.module === "invoices").length,
    logs: items.filter((i) => i.module === "logs").length,
    users: items.filter((i) => i.module === "users").length,
  };
  const filtered = filter === "all" ? items : items.filter((i) => i.module === filter);
  const table = useTableControls(filtered, archivedItemKey, filter);

  return (
    <>
      <PageHeader
        title={t("archives_title")}
        subtitle={t("archives_subtitle")}
      />

      {error && (
        <div className="mb-4 flex justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "proposals", "budgets", "contracts", "expenses", "invoices", "logs", "users"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "border-[#1a3d2b] bg-[#1a3d2b] text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
            }`}
          >
            {f === "all" ? t("archives_filter_all") : t(MODULE_LABEL_KEY[f])}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter === f ? "bg-white/20" : "bg-stone-100"}`}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">{t("archives_loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-stone-400">{t("archives_empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-3 px-4 py-1 text-xs text-stone-500">
            <SelectAllCheckbox controls={table} />
            {t("table_select_all")}
          </label>
          {table.rows.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4">
              <RowCheckbox checked={table.isSelected(item)} onChange={() => table.toggle(item)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
                    {t(MODULE_LABEL_KEY[item.module])}
                  </span>
                </div>
                <p className="mt-1 truncate font-medium text-stone-900">{item.title}</p>
                {item.subtitle && <p className="truncate text-sm text-stone-500">{item.subtitle}</p>}
                <p className="mt-0.5 text-xs text-stone-400">
                  {t("archives_deleted_at").replace("{date}", item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "—")}
                  {item.deletedBy ? t("archives_deleted_by").replace("{user}", item.deletedBy) : ""}
                </p>
              </div>
              <Button variant="primary" size="sm" loading={restoringKey === item.key} onClick={() => restore(item)}>
                {t("archives_restore_button")}
              </Button>
            </div>
          ))}
          <div className="overflow-hidden rounded-xl border border-stone-200">
            <TableFooter controls={table} />
          </div>
        </div>
      )}
    </>
  );
}
