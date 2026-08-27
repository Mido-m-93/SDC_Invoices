"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import ClientPicker from "@/components/ui/ClientPicker";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import type { StagedPipelineRecord, PipelineRecordStatus, PipelineSourceType, Client, PipelineSyncAuditEntry, Proposal, Contract } from "@/types";

const SOURCE_LABEL: Record<PipelineSourceType, string> = { notion: "Notion", sharepoint: "SharePoint" };

// Same threshold as /api/pipeline-sync/[id]/validate's "does anything
// plausibly related exist?" check (looser than the 0.85 auto-link bar) —
// kept in sync so the at-a-glance badge agrees with the validation panel.
const EXISTENCE_THRESHOLD = 0.45;

function existenceCounts(rawClientName: string, contracts: Contract[], proposals: Proposal[]) {
  const contractCount = contracts.filter(
    (c) => Math.max(similarity(rawClientName, c.clientName ?? ""), similarity(rawClientName, c.projectName)) >= EXISTENCE_THRESHOLD
  ).length;
  const proposalCount = proposals.filter(
    (p) => Math.max(similarity(rawClientName, p.clientName ?? ""), similarity(rawClientName, p.projectName)) >= EXISTENCE_THRESHOLD
  ).length;
  return { contractCount, proposalCount };
}

const STATUS_COLORS: Record<PipelineRecordStatus, string> = {
  auto_linked: "bg-emerald-50 text-emerald-700",
  needs_review: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
};

type Override = { clientId: string; clientName: string };

interface ValidationResult {
  recordId: string;
  rawClientName: string;
  projectName: string;
  estimatedAmount: number | null;
  stages: {
    clientExists: {
      pass: boolean;
      contractCount: number;
      proposalCount: number;
    };
    contractMatch: {
      found: boolean;
      contract: {
        id: string;
        projectName: string;
        clientName: string | null;
        expectedMonthlyAmount: number;
        currency: string;
        status: string;
        folderUrl: string | null;
        score: number;
      } | null;
      amountClose: { close: boolean; diffPct: number | null };
    };
    proposalMatch: {
      found: boolean;
      proposal: {
        id: string;
        projectName: string;
        clientName: string | null;
        estimatedAmount: number;
        currency: string;
        status: string;
        folderUrl: string | null;
        score: number;
      } | null;
      amountClose: { close: boolean; diffPct: number | null };
    };
    proposalContractCross: {
      applicable: boolean;
      amountClose: { close: boolean; diffPct: number | null } | null;
      proposalAmount: number | null;
      contractAmount: number | null;
      currency: string;
    };
  };
}

interface ValidationPanel {
  record: StagedPipelineRecord;
  result: ValidationResult | null;
  loading: boolean;
}

export default function PipelineSyncPage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const STATUS_LABELS: Record<PipelineRecordStatus, string> = {
    auto_linked: t("pipeline_sync_status_auto_linked"),
    needs_review: t("pipeline_sync_status_needs_review"),
    approved: t("pipeline_sync_status_approved"),
    rejected: t("pipeline_sync_status_rejected"),
  };
  const [records, setRecords] = useState<StagedPipelineRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [statusFilter, setStatusFilter] = useState<PipelineRecordStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<PipelineSourceType | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [syncDetail, setSyncDetail] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<Record<PipelineSourceType, "real" | "mock"> | null>(null);
  const [validationPanel, setValidationPanel] = useState<ValidationPanel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes, conRes, propRes] = await Promise.all([
        fetch("/api/pipeline-sync"),
        fetch("/api/pipeline-sync/clients"),
        fetch("/api/contracts"),
        fetch("/api/proposals"),
      ]);
      const rData = (await rRes.json()) as { records: StagedPipelineRecord[]; sourceStatus?: Record<PipelineSourceType, "real" | "mock"> };
      const cData = (await cRes.json()) as { clients: Client[] };
      const conData = (await conRes.json()) as { contracts: Contract[] };
      const propData = (await propRes.json()) as { proposals: Proposal[] };
      setRecords(rData.records ?? []);
      setSourceStatus(rData.sourceStatus ?? null);
      setClients(cData.clients ?? []);
      setContracts(conData.contracts ?? []);
      setProposals(propData.proposals ?? []);
    } catch {
      setError(t("pipeline_sync_error_load"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function overrideFor(r: StagedPipelineRecord): Override {
    return overrides[r.id] ?? { clientId: r.matchedClientId ?? "", clientName: r.matchedClientName ?? r.rawClientName };
  }

  async function runSync(source: PipelineSourceType) {
    setSyncing(source);
    setError(null);
    setSyncDetail(null);
    notify("info", t("pipeline_sync_notify_syncing").replace("{source}", SOURCE_LABEL[source]), "/pipeline-sync");
    try {
      const res = await fetch("/api/pipeline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; staged?: number; autoLinked?: number; needsReview?: number };
      if (!res.ok) {
        const message = data.error ?? t("pipeline_sync_error_sync_failed");
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      await load();
      await loadLastExtractDetail(source);
      notify(
        "success",
        t("pipeline_sync_notify_synced")
          .replace("{source}", SOURCE_LABEL[source])
          .replace("{staged}", String(data.staged ?? 0))
          .replace("{autoLinked}", String(data.autoLinked ?? 0))
          .replace("{needsReview}", String(data.needsReview ?? 0)),
        "/pipeline-sync"
      );
    } catch {
      const message = t("pipeline_sync_error_sync_failed");
      setError(message);
      notify("error", message);
    } finally {
      setSyncing(null);
    }
  }

  async function loadLastExtractDetail(source: PipelineSourceType) {
    try {
      const res = await fetch("/api/pipeline-sync/audit");
      const data = (await res.json()) as { entries?: PipelineSyncAuditEntry[] };
      const last = (data.entries ?? [])
        .filter((e) => e.action === "extract" && e.source === source)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      setSyncDetail(last ? last.detail : null);
    } catch {
      // best-effort diagnostic only
    }
  }

  // Open validation panel and run the 3-stage check
  async function openValidation(r: StagedPipelineRecord) {
    setValidationPanel({ record: r, result: null, loading: true });
    try {
      const res = await fetch(`/api/pipeline-sync/${r.id}/validate`, { method: "POST" });
      const data = (await res.json()) as ValidationResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Validation failed");
      setValidationPanel({ record: r, result: data, loading: false });
    } catch (err) {
      setValidationPanel({ record: r, result: null, loading: false });
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  }

  async function confirmApprove() {
    if (!validationPanel) return;
    const r = validationPanel.record;
    setBusyId(r.id);
    setError(null);
    try {
      const override = overrideFor(r);
      const res = await fetch(`/api/pipeline-sync/${r.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideClientId: override.clientId || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const message = data.error ?? t("pipeline_sync_error_approve_failed");
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      setValidationPanel(null);
      await load();
      notify("success", t("pipeline_sync_notify_approved").replace("{name}", r.rawClientName), "/pipeline-sync");
    } catch {
      const message = t("pipeline_sync_error_approve_failed");
      setError(message);
      notify("error", message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(r: StagedPipelineRecord) {
    const reason = prompt(t("pipeline_sync_reject_prompt").replace("{name}", r.rawClientName));
    if (reason === null) return;
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline-sync/${r.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const message = data.error ?? t("pipeline_sync_error_reject_failed");
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      await load();
      notify("info", t("pipeline_sync_notify_rejected").replace("{name}", r.rawClientName), "/pipeline-sync");
    } catch {
      const message = t("pipeline_sync_error_reject_failed");
      setError(message);
      notify("error", message);
    } finally {
      setBusyId(null);
    }
  }

  const mockSourceLabels = [
    sourceStatus?.notion === "mock" ? "Notion" : null,
    sourceStatus?.sharepoint === "mock" ? "SharePoint" : null,
  ].filter((label): label is string => label !== null);

  const byStatus = statusFilter === "all" ? records : records.filter((r) => r.status === statusFilter);
  const query = search.trim().toLowerCase();
  const filtered = query
    ? byStatus.filter((r) =>
        [r.rawClientName, r.projectName, r.contactName ?? "", r.contactEmail ?? "", r.notes ?? ""]
          .some((field) => field.toLowerCase().includes(query))
      )
    : byStatus;
  const counts = {
    all: records.length,
    auto_linked: records.filter((r) => r.status === "auto_linked").length,
    needs_review: records.filter((r) => r.status === "needs_review").length,
    approved: records.filter((r) => r.status === "approved").length,
    rejected: records.filter((r) => r.status === "rejected").length,
  };

  // Determine overall panel result for the summary badge
  const panelResult = validationPanel?.result;
  const allGreen = panelResult && panelResult.stages.clientExists.pass && panelResult.stages.contractMatch.found && panelResult.stages.proposalMatch.found;
  const hasFlag = panelResult && (!panelResult.stages.clientExists.pass || !panelResult.stages.contractMatch.found || !panelResult.stages.proposalMatch.found);

  return (
    <AppShell>
      <PageHeader
        title={t("nav_pipeline_sync")}
        subtitle={t("pipeline_sync_subtitle")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" loading={syncing === "notion"} onClick={() => runSync("notion")}>
              {t("pipeline_sync_run_notion")}
            </Button>
            <Button variant="secondary" loading={syncing === "sharepoint"} onClick={() => runSync("sharepoint")}>
              {t("pipeline_sync_run_sharepoint")}
            </Button>
          </div>
        }
      />

      {mockSourceLabels.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <strong>{t("pipeline_sync_mock_mode_label")}</strong> — {mockSourceLabels.join(" & ")} {t("pipeline_sync_mock_mode_text")}
        </div>
      )}

      {error && (
        <div className="mb-4 flex justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {syncDetail && (
        <div className="mb-4 flex justify-between gap-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800">
          <span><strong>{t("pipeline_sync_last_run_label")}</strong> {syncDetail}</span>
          <button onClick={() => setSyncDetail(null)} className="shrink-0 text-sky-400 hover:text-sky-600">×</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "needs_review", "auto_linked", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s ? "border-[#1a3d2b] bg-[#1a3d2b] text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
              }`}
            >
              {s === "all" ? t("pipeline_sync_filter_all") : STATUS_LABELS[s]}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusFilter === s ? "bg-white/20" : "bg-stone-100"}`}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs sm:w-64">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, project, contact…"
            className="w-full rounded-lg border border-stone-200 py-1.5 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/20"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {query && (
        <p className="mb-3 text-xs text-stone-400">
          {filtered.length} result{filtered.length === 1 ? "" : "s"} for &ldquo;{search.trim()}&rdquo;
        </p>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-stone-400">{t("pipeline_sync_empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const override = overrideFor(r);
            const pending = r.status === "auto_linked" || r.status === "needs_review";
            const { contractCount, proposalCount } = existenceCounts(r.rawClientName, contracts, proposals);
            return (
              <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono uppercase text-stone-400">{r.source}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                      {pending && (
                        <span className="text-xs text-stone-400">{t("pipeline_sync_confidence").replace("{pct}", (r.matchConfidence * 100).toFixed(0))}</span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          proposalCount > 0 || contractCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"
                        }`}
                        title="Existing proposals/contracts fuzzy-matched by client name"
                      >
                        {proposalCount > 0 || contractCount > 0
                          ? `${proposalCount} proposal${proposalCount === 1 ? "" : "s"} · ${contractCount} contract${contractCount === 1 ? "" : "s"}`
                          : "No proposal or contract yet"}
                      </span>
                    </div>
                    <p className="mt-1 font-medium text-stone-900">{r.rawClientName}</p>
                    <p className="text-sm text-stone-500">{r.projectName || "—"} · {r.stageOrStatus}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {r.estimatedAmount ? `${r.currency} ${r.estimatedAmount.toLocaleString()}` : t("pipeline_sync_no_amount")}
                      {r.contactName ? ` · ${r.contactName}` : ""}
                    </p>
                    {r.status === "rejected" && r.reviewerComment && (
                      <p className="mt-1 text-xs text-red-600">{t("pipeline_sync_rejected_label").replace("{comment}", r.reviewerComment)}</p>
                    )}
                    {r.status === "approved" && (
                      <p className="mt-1 text-xs text-blue-600">
                        {t("pipeline_sync_linked_to").replace("{client}", r.matchedClientName ?? "").replace("{leadId}", r.createdLeadId ?? "")}
                      </p>
                    )}
                  </div>

                  {pending && (
                    <div className="w-64 shrink-0">
                      <ClientPicker
                        clients={clients}
                        clientId={override.clientId}
                        clientName={override.clientName}
                        onChange={(clientId, clientName) =>
                          setOverrides((o) => ({ ...o, [r.id]: { clientId, clientName } }))
                        }
                        onClientCreated={(c) => setClients((cs) => [...cs, c])}
                        createEndpoint="/api/pipeline-sync/clients"
                        className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/20"
                      />
                    </div>
                  )}
                </div>

                {pending && (
                  <div className="mt-3 flex justify-end gap-2 border-t border-stone-100 pt-3">
                    <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => reject(r)}>
                      {t("pipeline_sync_reject")}
                    </Button>
                    <Button variant="primary" size="sm" loading={busyId === r.id} onClick={() => openValidation(r)}>
                      {t("pipeline_sync_approve")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Validation panel (right-side drawer) ── */}
      {validationPanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setValidationPanel(null)}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col bg-white shadow-2xl">
            {/* Panel header */}
            <div className="flex items-start justify-between border-b border-stone-100 px-6 py-5">
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-0.5">AI Validation</p>
                <h2 className="text-base font-semibold text-stone-900">{validationPanel.record.rawClientName}</h2>
                <p className="text-xs text-stone-500 mt-0.5">{validationPanel.record.projectName || "—"}</p>
              </div>
              <button onClick={() => setValidationPanel(null)} className="mt-1 text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
            </div>

            {/* Summary badge */}
            {panelResult && (
              <div className={`mx-6 mt-4 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                allGreen
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                {allGreen
                  ? "✓ All checks passed — safe to create lead"
                  : "⚠ Some checks need review — lead can still be created"}
              </div>
            )}

            {/* Stage cards */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {validationPanel.loading ? (
                <div className="flex items-center justify-center py-16 text-sm text-stone-400">
                  Running AI checks…
                </div>
              ) : panelResult ? (
                <div>
                  {/* Stage 1 */}
                  <ValidationStage
                    number={1}
                    title="Client exists in system?"
                    subtitle="Matched against contracts and proposals"
                    pass={panelResult.stages.clientExists.pass}
                    warn={false}
                    lines={
                      panelResult.stages.clientExists.pass
                        ? [
                            panelResult.stages.clientExists.contractCount > 0
                              ? `✓ Found in ${panelResult.stages.clientExists.contractCount} contract(s)`
                              : "",
                            panelResult.stages.clientExists.proposalCount > 0
                              ? `✓ Found in ${panelResult.stages.clientExists.proposalCount} proposal(s)`
                              : "",
                          ].filter(Boolean)
                        : ["No matching client found in contracts or proposals"]
                    }
                  />

                  {/* Stage 2 */}
                  <ValidationStage
                    number={2}
                    title="Contract exists for this client?"
                    subtitle="Name match + amount comparison"
                    pass={panelResult.stages.contractMatch.found && (panelResult.stages.contractMatch.amountClose.close || panelResult.stages.contractMatch.amountClose.diffPct === null)}
                    warn={panelResult.stages.contractMatch.found && panelResult.stages.contractMatch.amountClose.diffPct !== null && !panelResult.stages.contractMatch.amountClose.close}
                    lines={(() => {
                      const c = panelResult.stages.contractMatch;
                      if (!c.found) return ["No contract found for this client"];
                      const lines = [
                        `✓ Matched: "${c.contract!.projectName}" (${c.contract!.score}% name match)`,
                        c.contract!.expectedMonthlyAmount
                          ? `Expected: ${c.contract!.currency} ${c.contract!.expectedMonthlyAmount.toLocaleString()}/mo`
                          : "",
                        c.amountClose.diffPct !== null
                          ? c.amountClose.close
                            ? `✓ Amount within ${c.amountClose.diffPct}% of contract`
                            : `⚠ Amount differs by ${c.amountClose.diffPct}% from contract`
                          : "",
                      ].filter(Boolean);
                      return lines;
                    })()}
                    link={panelResult.stages.contractMatch.contract?.folderUrl ?? null}
                    linkLabel="View Contract"
                  />

                  {/* Stage 3 */}
                  <ValidationStage
                    number={3}
                    title="Proposal exists for this client?"
                    subtitle="Name match + amount comparison"
                    pass={panelResult.stages.proposalMatch.found && (panelResult.stages.proposalMatch.amountClose.close || panelResult.stages.proposalMatch.amountClose.diffPct === null)}
                    warn={panelResult.stages.proposalMatch.found && panelResult.stages.proposalMatch.amountClose.diffPct !== null && !panelResult.stages.proposalMatch.amountClose.close}
                    lines={(() => {
                      const p = panelResult.stages.proposalMatch;
                      if (!p.found) return ["No proposal found for this client"];
                      const lines = [
                        `✓ Matched: "${p.proposal!.projectName}" (${p.proposal!.score}% name match)`,
                        p.proposal!.estimatedAmount
                          ? `Proposed: ${p.proposal!.currency} ${p.proposal!.estimatedAmount.toLocaleString()}`
                          : "",
                        p.amountClose.diffPct !== null
                          ? p.amountClose.close
                            ? `✓ Amount within ${p.amountClose.diffPct}% of proposal`
                            : `⚠ Amount differs by ${p.amountClose.diffPct}% from proposal`
                          : "",
                      ].filter(Boolean);
                      return lines;
                    })()}
                    link={panelResult.stages.proposalMatch.proposal?.folderUrl ?? null}
                    linkLabel="View Proposal"
                  />

                  {/* Stage 4: Proposal ↔ Contract cross-check */}
                  {(() => {
                    const cross = panelResult.stages.proposalContractCross;
                    if (!cross.applicable) {
                      return (
                        <ValidationStage
                          number={4}
                          title="Proposal ↔ Contract amount match"
                          subtitle="Cross-check: do proposal and contract agree?"
                          pass={false}
                          warn={false}
                          lines={["Skipped — need both a matched contract and proposal to compare"]}
                          isLast
                        />
                      );
                    }
                    const close = cross.amountClose?.close ?? false;
                    const diffPct = cross.amountClose?.diffPct ?? null;
                    return (
                      <ValidationStage
                        number={4}
                        title="Proposal ↔ Contract amount match"
                        subtitle="Cross-check: do proposal and contract agree?"
                        pass={close}
                        warn={!close && diffPct !== null}
                        lines={[
                          `Proposal: ${cross.currency} ${cross.proposalAmount?.toLocaleString() ?? "—"}`,
                          `Contract: ${cross.currency} ${cross.contractAmount?.toLocaleString() ?? "—"}`,
                          diffPct !== null
                            ? close
                              ? `✓ Amounts match within ${diffPct}%`
                              : `⚠ Amounts differ by ${diffPct}% — review before proceeding`
                            : "Could not compare amounts",
                        ]}
                        isLast
                      />
                    );
                  })()}
                </div>
              ) : (
                <p className="text-sm text-red-600">Could not run validation. You can still create the lead below.</p>
              )}
            </div>

            {/* Footer actions */}
            <div className="border-t border-stone-100 px-6 py-4 flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setValidationPanel(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={!!busyId}
                onClick={confirmApprove}
              >
                {hasFlag ? "Create Lead (Needs Review)" : "Confirm & Create Lead"}
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

// ── Validation stage card ─────────────────────────────────────────────────────

function ValidationStage({
  number, title, subtitle, pass, warn, lines, link, linkLabel, isLast,
}: {
  number: number;
  title: string;
  subtitle: string;
  pass: boolean;
  warn: boolean;
  lines: string[];
  link?: string | null;
  linkLabel?: string;
  isLast?: boolean;
}) {
  const status = warn ? "warn" : pass ? "pass" : "fail";
  const colors = {
    pass: { card: "bg-emerald-50 border-emerald-200", num: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: "✓", label: "Passed" },
    warn: { card: "bg-amber-50 border-amber-200",    num: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",   text: "text-amber-700",   icon: "⚠", label: "Review" },
    fail: { card: "bg-red-50 border-red-200",         num: "bg-red-500",     badge: "bg-red-100 text-red-700",       text: "text-red-700",     icon: "✕", label: "Not found" },
  }[status];

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${colors.num}`}>
          {number}
        </div>
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
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#1a3d2b] underline underline-offset-2 hover:opacity-75"
          >
            {linkLabel ?? "View"} →
          </a>
        )}
      </div>
    </div>
  );
}
