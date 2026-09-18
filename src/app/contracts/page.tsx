"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import VerificationBadge from "@/components/ui/VerificationBadge";
import MembersContractTab from "@/components/contracts/MembersContractTab";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import type { Contract, Vendor, Client, Proposal, Budget } from "@/types";
import { generateId } from "@/lib/utils";

type ContractForm = Omit<Contract, "id" | "createdAt">;

const EMPTY_CONTRACT: ContractForm = {
  vendorId: "", clientId: "", clientName: "",
  projectName: "", startDate: "", endDate: "",
  expectedMonthlyAmount: 0, currency: "JPY",
  paymentTerms: "", status: "active",
  proposalId: "", budgetId: "", contractFolderUrl: "",
};

const STATUS_COLORS: Record<Contract["status"], string> = {
  draft: "bg-stone-100 text-stone-600",
  signed: "bg-blue-50 text-blue-700",
  active: "bg-emerald-100 text-emerald-700",
  expired: "bg-stone-100 text-stone-500",
  cancelled: "bg-red-100 text-red-600",
};

export default function ContractsPage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<"contracts" | "members">("contracts");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContractForm>({ ...EMPTY_CONTRACT });
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyingBudget, setVerifyingBudget] = useState<string | null>(null);
  const [markingReviewed, setMarkingReviewed] = useState<string | null>(null);
  const [checkingBilling, setCheckingBilling] = useState<string | null>(null);
  const [viewingFiles, setViewingFiles] = useState<Contract | null>(null);
  const [folderFiles, setFolderFiles] = useState<{ name: string; isFolder: boolean; size: number | null; webUrl: string | null }[] | null>(null);
  const [folderFilesError, setFolderFilesError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [linkingFile, setLinkingFile] = useState<string | null>(null);
  const [folderFilesFuzzy, setFolderFilesFuzzy] = useState<{ folderName: string } | null>(null);
  const [search, setSearch] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDetails, setSyncDetails] = useState<Array<{ folder: string; file: string; matchedContractId: string | null; updated: boolean; reason?: string }> | null>(null);
  const [showSyncDetails, setShowSyncDetails] = useState(false);

  // One button: import any missing Contract records from SharePoint first,
  // then run the match/sync against the now-complete set.
  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    setSyncDetails(null);
    setError(null);
    try {
      const importRes = await fetch("/api/admin/import-contracts", { method: "POST" });
      const importData = await importRes.json() as { added?: number; skipped?: number; error?: string };
      if (!importRes.ok) {
        setError(importData.error ?? t("contracts_import_failed"));
        notify("error", `Contract import failed: ${importData.error ?? t("contracts_import_failed")}`, "/contracts");
        return;
      }

      const res = await fetch("/api/contracts/sync", { method: "POST" });
      const data = await res.json() as { matched?: number; updated?: number; skipped?: number; total?: number; error?: string; details?: typeof syncDetails };
      if (!res.ok) {
        setError(data.error ?? t("contracts_sync_failed"));
        notify("error", `Contract sync failed: ${data.error ?? t("contracts_sync_failed")}`, "/contracts");
        return;
      }
      setSyncMsg(
        t("contracts_import_result")
          .replace("{added}", String(importData.added ?? 0))
          .replace("{skipped}", String(importData.skipped ?? 0))
        + " — "
        + t("contracts_sync_result")
          .replace("{updated}", String(data.updated ?? 0))
          .replace("{matched}", String(data.matched ?? 0))
          .replace("{total}", String(data.total ?? 0))
      );
      setSyncDetails(data.details ?? []);
      notify("success", `Imported ${importData.added ?? 0}, synced: ${data.updated ?? 0} updated of ${data.total ?? 0} total`, "/contracts");
      load();
    } catch {
      setError(t("contracts_sync_failed"));
      notify("error", "Contract sync failed", "/contracts");
    } finally {
      setSyncing(false);
    }
  }

  async function handleVerify(c: Contract) {
    setVerifying(c.id);
    try {
      const res = await fetch(`/api/contracts/${c.id}/verify`, { method: "POST" });
      if (res.ok) {
        notify("success", `Verified contract for ${c.projectName || c.id}`, "/contracts");
        load();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? t("contracts_sync_failed"));
        notify("error", data.error ?? `Failed to verify contract for ${c.projectName || c.id}`, "/contracts");
      }
    } catch {
      setError(t("contracts_sync_failed"));
      notify("error", `Failed to verify contract for ${c.projectName || c.id}`, "/contracts");
    } finally {
      setVerifying(null);
    }
  }

  async function handleVerifyBudget(c: Contract) {
    setVerifyingBudget(c.id);
    try {
      const res = await fetch(`/api/contracts/${c.id}/verify-budget`, { method: "POST" });
      if (res.ok) {
        notify("success", `Verified contract vs budget for ${c.projectName || c.id}`, "/contracts");
        load();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? t("contracts_sync_failed"));
        notify("error", data.error ?? `Failed to verify contract vs budget for ${c.projectName || c.id}`, "/contracts");
      }
    } catch {
      setError(t("contracts_sync_failed"));
      notify("error", `Failed to verify contract vs budget for ${c.projectName || c.id}`, "/contracts");
    } finally {
      setVerifyingBudget(null);
    }
  }

  async function updateContractFields(c: Contract, fields: Partial<Contract>) {
    const res = await fetch(`/api/contracts/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, ...fields }),
    });
    if (!res.ok) throw new Error(t("contracts_save_failed"));
  }

  async function handleMarkReviewed(c: Contract) {
    setMarkingReviewed(c.id);
    try {
      await updateContractFields(c, { reviewedAt: new Date().toISOString(), reviewedBy: user ?? "" });
      notify("success", `Marked contract for ${c.projectName || c.id} as reviewed`, "/contracts");
      load();
    } catch {
      setError(t("contracts_save_failed"));
      notify("error", `Failed to mark contract for ${c.projectName || c.id} as reviewed`, "/contracts");
    } finally {
      setMarkingReviewed(null);
    }
  }

  async function handleCheckBillingRules(c: Contract) {
    setCheckingBilling(c.id);
    try {
      await updateContractFields(c, {
        billingRulesChecked: true,
        billingRulesCheckedAt: new Date().toISOString(),
        billingRulesCheckedBy: user ?? "",
      });
      notify("success", `Confirmed billing rules for ${c.projectName || c.id}`, "/contracts");
      load();
    } catch {
      setError(t("contracts_save_failed"));
      notify("error", `Failed to confirm billing rules for ${c.projectName || c.id}`, "/contracts");
    } finally {
      setCheckingBilling(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, vRes, clRes, pRes, bRes] = await Promise.all([
        fetch("/api/contracts"),
        fetch("/api/vendors"),
        fetch("/api/clients"),
        fetch("/api/proposals"),
        fetch("/api/budgets"),
      ]);
      const cData = await cRes.json() as { contracts: Contract[] };
      const vData = await vRes.json() as { vendors: Vendor[] };
      const clData = await clRes.json() as { clients: Client[] };
      const pData = await pRes.json() as { proposals: Proposal[] };
      const bData = await bRes.json() as { budgets: Budget[] };
      setContracts(cData.contracts ?? []);
      setVendors(vData.vendors ?? []);
      setClients(clData.clients ?? []);
      setProposals(pData.proposals ?? []);
      setBudgets(bData.budgets ?? []);
    } catch {
      setError(t("contracts_load_failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_CONTRACT });
    setShowForm(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      vendorId: c.vendorId,
      clientId: c.clientId ?? "",
      clientName: c.clientName ?? "",
      projectName: c.projectName,
      startDate: c.startDate,
      endDate: c.endDate,
      expectedMonthlyAmount: c.expectedMonthlyAmount,
      currency: c.currency,
      paymentTerms: c.paymentTerms,
      status: c.status,
      proposalId: c.proposalId ?? "",
      budgetId: c.budgetId ?? "",
      contractFolderUrl: c.contractFolderUrl ?? "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (form.clientId && !form.proposalId) {
      setError(t("contracts_field_proposal_required_hint"));
      return;
    }
    setSaving(true);
    try {
      const payload: ContractForm & { id?: string; createdAt?: string } = {
        ...form,
        clientId: form.clientId || undefined,
        clientName: form.clientName || undefined,
        proposalId: form.proposalId || undefined,
        budgetId: form.budgetId || undefined,
        contractFolderUrl: form.contractFolderUrl || undefined,
      };
      const url = editing ? `/api/contracts/${editing.id}` : "/api/contracts";
      const method = editing ? "PUT" : "POST";
      if (!editing) {
        payload.id = generateId("con");
        payload.createdAt = new Date().toISOString();
      }
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? t("contracts_save_failed"));
        notify("error", `Failed to save contract ${form.projectName}: ${data.error ?? t("contracts_save_failed")}`, "/contracts");
        return;
      }
      setShowForm(false);
      notify("success", editing ? `Updated contract ${form.projectName}` : `Added contract ${form.projectName}`, "/contracts");
      load();
    } catch {
      setError(t("contracts_save_failed"));
      notify("error", `Failed to save contract ${form.projectName}`, "/contracts");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("contracts_delete_confirm"))) return;
    const target = contracts.find((c) => c.id === id);
    const label = target?.clientName || target?.projectName || id;
    try {
      await fetch(`/api/contracts/${id}`, { method: "DELETE" });
      notify("info", `Deleted contract ${label} — restore from Archives if needed`, "/archives");
      load();
    } catch (err) {
      setError(t("contracts_save_failed"));
      notify("error", `Failed to delete contract ${label}: ${String(err)}`, "/contracts");
    }
  }

  // Bounded-concurrency bulk delete (soft delete — see handleDelete) so a
  // large list doesn't fire 50+ simultaneous requests.
  async function handleDeleteAll() {
    const target = filteredContracts;
    if (target.length === 0) return;
    if (!confirm(t("contracts_delete_all_confirm").replace("{count}", String(target.length)))) return;

    setDeletingAll(true);
    setError(null);
    let succeeded = 0;
    let failed = 0;
    const queue = [...target];
    const CONCURRENCY = 5;
    async function worker() {
      let item;
      while ((item = queue.shift())) {
        try {
          const res = await fetch(`/api/contracts/${item.id}`, { method: "DELETE" });
          if (res.ok) succeeded++; else failed++;
        } catch {
          failed++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, target.length) }, worker));

    setDeletingAll(false);
    notify(
      failed === 0 ? "info" : "error",
      `Deleted ${succeeded} contract${succeeded === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed` : ""} — restore from Archives if needed`,
      "/archives"
    );
    load();
  }

  async function handleViewFiles(c: Contract) {
    setViewingFiles(c);
    setFolderFiles(null);
    setFolderFilesError(null);
    setFolderFilesFuzzy(null);
    setLoadingFiles(true);
    try {
      const res = await fetch(`/api/contracts/${c.id}/folder-files`);
      const data = await res.json() as { files?: typeof folderFiles; folderName?: string; fuzzyMatch?: boolean; error?: string };
      if (!res.ok) {
        setFolderFilesError(data.error ?? t("contracts_files_failed"));
        return;
      }
      setFolderFiles(data.files ?? []);
      if (data.fuzzyMatch && data.folderName) setFolderFilesFuzzy({ folderName: data.folderName });
    } catch {
      setFolderFilesError(t("contracts_files_failed"));
    } finally {
      setLoadingFiles(false);
    }
  }

  async function handleUseAsFolderLink(webUrl: string) {
    if (!viewingFiles) return;
    setLinkingFile(webUrl);
    try {
      await updateContractFields(viewingFiles, { contractFolderUrl: webUrl });
      notify("success", `Linked file to contract for ${viewingFiles.clientName || viewingFiles.projectName || viewingFiles.id}`, "/contracts");
      setViewingFiles(null);
      load();
    } catch {
      notify("error", "Failed to link file to contract", "/contracts");
    } finally {
      setLinkingFile(null);
    }
  }

  const set = <K extends keyof ContractForm>(k: K, v: ContractForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;
  const resolvedClientName = (c: Contract) =>
    c.clientName || clients.find(cl => cl.id === c.clientId)?.name || null;

  const filteredContracts = (() => {
    const query = search.trim().toLowerCase();
    if (!query) return contracts;
    return contracts.filter((c) =>
      [resolvedClientName(c), c.vendorId && vendorName(c.vendorId), c.projectName]
        .some((field) => field?.toLowerCase().includes(query))
    );
  })();

  return (
    <AppShell>
      <PageHeader
        title={t("contracts_title")}
        subtitle={t("contracts_subtitle")}
        actions={
          tab === "contracts" ? (
            <div className="flex gap-2">
              <Button variant="secondary" loading={syncing} onClick={handleSync}>{t("contracts_sync_button")}</Button>
              {contracts.length > 0 && (
                <Button variant="secondary" loading={deletingAll} onClick={handleDeleteAll}>{t("contracts_delete_all_button")}</Button>
              )}
              <Button variant="primary" onClick={openNew}>{t("contracts_add_button")}</Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex gap-1 border-b border-stone-200">
        {(["contracts", "members"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tb
                ? "border-[#1a3d2b] text-[#1a3d2b]"
                : "border-transparent text-stone-400 hover:text-stone-600"
            }`}
          >
            {tb === "contracts" ? t("contracts_tab_contracts") : t("contracts_tab_members")}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <MembersContractTab />
      ) : (
        <>
      {contracts.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <input
            className={`${input} max-w-xs`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("contracts_search_placeholder")}
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-stone-400 hover:text-stone-600">
              {t("contracts_search_clear")}
            </button>
          )}
          <span className="text-xs text-stone-400">
            {filteredContracts.length} / {contracts.length} {t("contracts_search_shown")}
          </span>
        </div>
      )}

      {syncMsg && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
          <div className="flex justify-between items-center">
            <span>{syncMsg}</span>
            <div className="flex items-center gap-3">
              {syncDetails && syncDetails.length > 0 && (
                <button onClick={() => setShowSyncDetails(v => !v)} className="text-xs underline text-emerald-700 hover:text-emerald-900">
                  {showSyncDetails ? t("contracts_sync_hide_files") : t("contracts_sync_show_files")}
                </button>
              )}
              <button onClick={() => { setSyncMsg(null); setSyncDetails(null); }} className="text-emerald-400 hover:text-emerald-600">×</button>
            </div>
          </div>
          {showSyncDetails && syncDetails && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-emerald-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-emerald-50 text-emerald-700 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">{t("contracts_sync_col_folder")}</th>
                    <th className="px-3 py-2 text-left">{t("contracts_sync_col_file")}</th>
                    <th className="px-3 py-2 text-left">{t("contracts_sync_col_result")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-600">
                  {syncDetails.map((d, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5">{d.folder}</td>
                      <td className="px-3 py-1.5">{d.file}</td>
                      <td className="px-3 py-1.5">
                        {d.updated
                          ? <span className="text-emerald-600">{t("contracts_sync_updated")}</span>
                          : d.matchedContractId
                          ? <span className="text-amber-600">{t("contracts_sync_matched_no_update")}</span>
                          : <span className="text-stone-400">{d.reason ?? "—"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : contracts.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("contracts_empty_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("contracts_empty_add_button")}</Button>
        </div>
      ) : filteredContracts.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("contracts_search_no_results")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">{t("contracts_col_client")}</th>
                <th className="px-4 py-3 text-left">{t("contracts_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("contracts_col_verification_combined")}</th>
                <th className="px-4 py-3 text-left">{t("contracts_col_review_billing")}</th>
                <th className="px-4 py-3 text-left">{t("contracts_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredContracts.map((c, idx) => {
                const clientDisplay = resolvedClientName(c);
                return (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 text-stone-400">{idx + 1}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {clientDisplay ?? <span className="text-stone-300">—</span>}
                      {c.proposalId && (
                        <div className="text-xs text-stone-400 font-mono mt-0.5">↗ {c.proposalId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                        {t(`contracts_status_${c.status}` as TranslationKey)}
                      </span>
                      {c.contractFolderUrl && (
                        <a href={c.contractFolderUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-500 hover:underline">
                          {t("contracts_folder_link")}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-stone-400 mb-0.5">{t("contracts_col_verification_proposal")}</p>
                          <VerificationBadge
                            verification={c.verificationProposal}
                            onVerify={() => handleVerify(c)}
                            verifying={verifying === c.id}
                            verifyLabel={t("contracts_action_verify")}
                            reverifyLabel={t("contracts_action_reverify")}
                          />
                          {c.clientName && (
                            <button onClick={() => handleViewFiles(c)} className="block text-xs text-blue-600 hover:underline mt-0.5">
                              {t("contracts_action_view_files")}
                            </button>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-stone-400 mb-0.5">{t("contracts_col_verification_budget")}</p>
                          <VerificationBadge
                            verification={c.verificationBudget}
                            onVerify={() => handleVerifyBudget(c)}
                            verifying={verifyingBudget === c.id}
                            verifyLabel={t("contracts_action_verify")}
                            reverifyLabel={t("contracts_action_reverify")}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        <div>
                          {c.reviewedAt ? (
                            <span className="text-xs text-emerald-700" title={c.reviewedBy ?? ""}>
                              ✓ {t("contracts_reviewed_label")}
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" loading={markingReviewed === c.id} onClick={() => handleMarkReviewed(c)}>
                              {t("contracts_action_mark_reviewed")}
                            </Button>
                          )}
                        </div>
                        <div>
                          {c.billingRulesChecked ? (
                            <span className="text-xs text-emerald-700" title={c.billingRulesCheckedBy ?? ""}>
                              ✓ {t("contracts_billing_checked_label")}
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" loading={checkingBilling === c.id} onClick={() => handleCheckBillingRules(c)}>
                              {t("contracts_action_check_billing")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {c.status === "active" && c.clientId && (
                        <Link href={`/outbound-invoices?contractId=${c.id}`} className="text-xs text-blue-600 hover:underline self-center">
                          {t("contracts_action_create_invoice")}
                        </Link>
                      )}
                      {c.clientName && (
                        <Button variant="ghost" size="sm" onClick={() => handleViewFiles(c)}>{t("contracts_action_view_files")}</Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>{t("contracts_action_edit")}</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>{t("contracts_action_delete")}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? t("contracts_modal_edit_title") : t("contracts_modal_add_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("contracts_field_vendor")}>
                <select className={input} value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
                  <option value="">{t("contracts_field_vendor_none_option")}</option>
                  {vendors.filter((v) => v.status === "active").map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("contracts_field_project_name")}>
                <input className={input} value={form.projectName} onChange={(e) => set("projectName", e.target.value)} placeholder={t("contracts_field_project_name_placeholder")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("contracts_field_start_date")}>
                  <input type="date" className={input} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
                </Field>
                <Field label={t("contracts_field_end_date")}>
                  <input type="date" className={input} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("contracts_col_monthly_amount")}>
                  <input type="number" className={input} value={form.expectedMonthlyAmount || ""} onChange={(e) => set("expectedMonthlyAmount", Number(e.target.value))} placeholder="330000" />
                </Field>
                <Field label={t("contracts_field_currency")}>
                  <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
              <Field label={t("contracts_field_payment_terms")}>
                <input className={input} value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder={t("contracts_field_payment_terms_placeholder")} />
              </Field>
              <Field label={t("contracts_col_status")}>
                <select className={input} value={form.status} onChange={(e) => set("status", e.target.value as Contract["status"])}>
                  <option value="draft">{t("contracts_status_draft")}</option>
                  <option value="signed">{t("contracts_status_signed")}</option>
                  <option value="active">{t("contracts_status_active")}</option>
                  <option value="expired">{t("contracts_status_expired")}</option>
                  <option value="cancelled">{t("contracts_status_cancelled")}</option>
                </select>
              </Field>

              {/* Pipeline links */}
              <div className="border-t border-stone-100 pt-4 space-y-4">
                <p className="text-xs text-stone-400">{t("contracts_pipeline_links_label")}</p>
                <Field label={t("contracts_col_client")}>
                  <select
                    className={input}
                    value={form.clientId ?? ""}
                    onChange={(e) => {
                      const client = clients.find(c => c.id === e.target.value);
                      setForm(f => ({ ...f, clientId: e.target.value, clientName: client?.name ?? "" }));
                    }}
                  >
                    <option value="">{t("contracts_field_client_none_option")}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label={t("contracts_field_proposal_id")}>
                  <select
                    className={input}
                    value={form.proposalId ?? ""}
                    onChange={e => set("proposalId", e.target.value)}
                  >
                    <option value="">{t("contracts_field_proposal_none_option")}</option>
                    {proposals
                      .filter(p => p.status === "accepted" && (!form.clientId || p.clientId === form.clientId))
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.projectName} — {p.clientName ?? p.clientId}</option>
                      ))}
                  </select>
                  {form.clientId && !form.proposalId && (
                    <p className="text-xs text-amber-600 mt-1">{t("contracts_field_proposal_required_hint")}</p>
                  )}
                </Field>
                <Field label={t("contracts_field_budget_id")}>
                  <select
                    className={input}
                    value={form.budgetId ?? ""}
                    onChange={e => set("budgetId", e.target.value)}
                  >
                    <option value="">{t("contracts_field_budget_none_option")}</option>
                    {budgets
                      .filter(b => !form.clientId || b.clientId === form.clientId)
                      .map(b => (
                        <option key={b.id} value={b.id}>{b.projectName} — {b.clientName ?? b.clientId}</option>
                      ))}
                  </select>
                </Field>
                <Field label={t("contracts_field_folder_url")}>
                  <input className={input} value={form.contractFolderUrl ?? ""} onChange={e => set("contractFolderUrl", e.target.value)} placeholder="https://drive.google.com/..." />
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t("contracts_save_button")}</Button>
            </div>
          </div>
        </div>
      )}

      {viewingFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]" onClick={() => setViewingFiles(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{viewingFiles.clientName}</h2>
              <button onClick={() => setViewingFiles(null)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5">
              {loadingFiles && <p className="text-sm text-stone-500">{t("contracts_files_loading")}</p>}
              {folderFilesError && <p className="text-sm text-red-600">{folderFilesError}</p>}
              {folderFiles && folderFiles.length === 0 && (
                <p className="text-sm text-stone-500">{t("contracts_files_empty")}</p>
              )}
              {folderFilesFuzzy && (
                <p className="mb-3 text-xs text-amber-600">
                  ⚠ No exact folder match for &ldquo;{viewingFiles.clientName}&rdquo; — closest match shown: &ldquo;{folderFilesFuzzy.folderName}&rdquo;. Double-check before linking.
                </p>
              )}
              {folderFiles && folderFiles.length > 0 && (
                <ul className="divide-y divide-stone-100">
                  {folderFiles.map((f) => (
                    <li key={f.name} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        {f.webUrl ? (
                          <a href={f.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                            {f.isFolder ? "📁 " : "📄 "}{f.name}
                          </a>
                        ) : (
                          <span className="text-stone-700 truncate block">{f.isFolder ? "📁 " : "📄 "}{f.name}</span>
                        )}
                        {!f.isFolder && f.size != null && (
                          <span className="text-xs text-stone-400">{Math.round(f.size / 1024)} KB</span>
                        )}
                      </div>
                      {!f.isFolder && f.webUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={linkingFile === f.webUrl}
                          onClick={() => handleUseAsFolderLink(f.webUrl!)}
                        >
                          Use as folder link
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </AppShell>
  );
}

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
