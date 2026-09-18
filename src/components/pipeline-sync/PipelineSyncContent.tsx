"use client";

import { useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import RefreshIcon from "@/components/ui/RefreshIcon";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import type { StagedPipelineRecord, PipelineRecordStatus, PipelineSourceType, Client, PipelineSyncAuditEntry, Proposal, Contract, Budget } from "@/types";

const SOURCE_LABEL: Record<PipelineSourceType, string> = { notion: "Notion", sharepoint: "SharePoint" };

// Same threshold as /api/pipeline-sync/[id]/validate's "does anything
// plausibly related exist?" check (looser than the 0.85 auto-link bar) —
// kept in sync so the at-a-glance badge agrees with the validation panel.
const EXISTENCE_THRESHOLD = 0.45;

function existenceCounts(rawClientName: string, contracts: Contract[], proposals: Proposal[], budgets: Budget[]) {
  const contractCount = contracts.filter(
    (c) => Math.max(similarity(rawClientName, c.clientName ?? ""), similarity(rawClientName, c.projectName)) >= EXISTENCE_THRESHOLD
  ).length;
  const proposalCount = proposals.filter(
    (p) => Math.max(similarity(rawClientName, p.clientName ?? ""), similarity(rawClientName, p.projectName)) >= EXISTENCE_THRESHOLD
  ).length;
  const budgetCount = budgets.filter(
    (b) => Math.max(similarity(rawClientName, b.clientName ?? ""), similarity(rawClientName, b.projectName)) >= EXISTENCE_THRESHOLD
  ).length;
  return { contractCount, proposalCount, budgetCount };
}

const STATUS_TONES: Record<PipelineRecordStatus, BadgeTone> = {
  auto_linked: "success",
  needs_review: "warning",
  approved: "info",
  rejected: "danger",
};

interface ValidationResult {
  recordId: string;
  rawClientName: string;
  projectName: string;
  estimatedAmount: number | null;
  stages: {
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
      allMatches: { name: string; url: string }[];
      linkMissing: boolean;
      linkDebug: string | null;
      suggestedLink: { name: string; url: string; score: number } | null;
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
      allMatches: { name: string; url: string }[];
      linkMissing: boolean;
      linkDebug: string | null;
      suggestedLink: { name: string; url: string; score: number } | null;
    };
    budgetMatch: {
      found: boolean;
      budget: {
        id: string;
        projectName: string;
        clientName: string | null;
        budgetAmount: number;
        currency: string;
        status: string;
        folderUrl: string | null;
        score: number;
      } | null;
      amountClose: { close: boolean; diffPct: number | null };
      allMatches: { name: string; url: string }[];
      linkMissing: boolean;
      linkDebug: string | null;
      suggestedLink: { name: string; url: string; score: number } | null;
    };
    proposalContractCross: {
      applicable: boolean;
      amountClose: { close: boolean; diffPct: number | null } | null;
      proposalAmount: number | null;
      contractAmount: number | null;
      currency: string;
    };
    threeWayCross: {
      applicable: boolean;
      allClose: boolean;
      proposalAmount: number | null;
      contractAmount: number | null;
      budgetAmount: number | null;
      currency: string;
      proposalVsContract: { close: boolean; diffPct: number | null } | null;
      proposalVsBudget: { close: boolean; diffPct: number | null } | null;
      contractVsBudget: { close: boolean; diffPct: number | null } | null;
    };
  };
}

interface ValidationPanel {
  record: StagedPipelineRecord;
  result: ValidationResult | null;
  loading: boolean;
}

interface SharePointSearchResult {
  id: string;
  name: string;
  isFolder: boolean;
  webUrl: string;
  parentPath: string;
}

// Mirrors PipelineSourceScanDetail from pipelineSharePointSource.ts (that
// module is server-only and can't be imported into a client component).
interface ScanDetail {
  folder: string;
  file: string;
  extracted: number;
  skipped?: string;
}

interface PipelineSyncContentProps {
  // Compact mode drops the full PageHeader (title + subtitle) so this can sit
  // inside a tab alongside another header — the sync action buttons still render.
  compact?: boolean;
}

export default function PipelineSyncContent({ compact = false }: PipelineSyncContentProps) {
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
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [statusFilter, setStatusFilter] = useState<PipelineRecordStatus | "all">("all");
  const [sourceTab, setSourceTab] = useState<PipelineSourceType>("sharepoint");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<PipelineSourceType | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncDetail, setSyncDetail] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanDetail[] | null>(null);
  const [sourceStatus, setSourceStatus] = useState<Record<PipelineSourceType, "real" | "mock"> | null>(null);
  const [validationPanel, setValidationPanel] = useState<ValidationPanel | null>(null);
  const [sharePointResults, setSharePointResults] = useState<SharePointSearchResult[] | null>(null);
  const [sharePointSearching, setSharePointSearching] = useState(false);
  const [sharePointError, setSharePointError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes, conRes, propRes, budRes] = await Promise.all([
        fetch("/api/pipeline-sync"),
        fetch("/api/pipeline-sync/clients"),
        fetch("/api/contracts"),
        fetch("/api/proposals"),
        fetch("/api/budgets"),
      ]);
      const rData = (await rRes.json()) as { records: StagedPipelineRecord[]; sourceStatus?: Record<PipelineSourceType, "real" | "mock"> };
      const cData = (await cRes.json()) as { clients: Client[] };
      const conData = (await conRes.json()) as { contracts: Contract[] };
      const propData = (await propRes.json()) as { proposals: Proposal[] };
      const budData = (await budRes.json()) as { budgets: Budget[] };
      setRecords(rData.records ?? []);
      setSourceStatus(rData.sourceStatus ?? null);
      setClients(cData.clients ?? []);
      setContracts(conData.contracts ?? []);
      setProposals(propData.proposals ?? []);
      setBudgets(budData.budgets ?? []);
    } catch {
      setError(t("pipeline_sync_error_load"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the existence badge's Supabase snapshot from drifting too far behind
  // WorkTogether without re-running the (multi-minute) SharePoint sync on
  // every page visit. Throttled client-side rather than blocking the initial
  // load — the badge just shows last-synced data until this catches up.
  useEffect(() => {
    const SHAREPOINT_AUTO_SYNC_KEY = "pipelineSync:lastSharePointSync";
    const SHAREPOINT_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
    let lastSync = 0;
    try {
      lastSync = Number(window.localStorage.getItem(SHAREPOINT_AUTO_SYNC_KEY) ?? 0);
    } catch {
      // localStorage unavailable (private mode, etc.) — fall through and sync anyway
    }
    if (Date.now() - lastSync < SHAREPOINT_AUTO_SYNC_INTERVAL_MS) return;
    try {
      window.localStorage.setItem(SHAREPOINT_AUTO_SYNC_KEY, String(Date.now()));
    } catch {
      // best-effort throttle only
    }
    (async () => {
      try {
        await Promise.allSettled([
          fetch("/api/proposals/sync", { method: "POST" }),
          fetch("/api/contracts/sync", { method: "POST" }),
        ]);
        await load();
      } catch {
        // background refresh is best-effort; existing data just stays as-is
      }
    })();
  }, [load]);

  // Live SharePoint filename/folder search, separate from the local filter
  // above (which only searches records already staged in this list) — lets
  // a reviewer check "does this client actually have anything in
  // WorkTogether" without waiting for or triggering a full sync. Debounced
  // so every keystroke doesn't fire a Graph API call.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSharePointResults(null);
      setSharePointError(null);
      return;
    }
    setSharePointSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pipeline-sync/sharepoint-search?q=${encodeURIComponent(q)}`);
        const data = (await res.json().catch(() => ({}))) as { results?: SharePointSearchResult[]; error?: string };
        if (!res.ok) {
          setSharePointError(data.error ?? "SharePoint search failed");
          setSharePointResults(null);
          return;
        }
        setSharePointError(null);
        setSharePointResults(data.results ?? []);
      } catch {
        setSharePointError("SharePoint search failed");
        setSharePointResults(null);
      } finally {
        setSharePointSearching(false);
      }
    }, 400);
    return () => { clearTimeout(timer); setSharePointSearching(false); };
  }, [search]);

  async function runSync(source: PipelineSourceType) {
    setSyncing(source);
    setError(null);
    setSyncDetail(null);
    if (source === "sharepoint") setLastScan(null);
    notify("info", t("pipeline_sync_notify_syncing").replace("{source}", SOURCE_LABEL[source]), "/pipeline-sync");
    try {
      const res = await fetch("/api/pipeline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; staged?: number; autoLinked?: number; needsReview?: number; scan?: ScanDetail[] };
      if (!res.ok) {
        const message = data.error ?? t("pipeline_sync_error_sync_failed");
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      if (source === "sharepoint") setLastScan(data.scan ?? []);
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
      notify("error", message, "/pipeline-sync");
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
      notify("error", message, "/pipeline-sync");
    } finally {
      setBusyId(null);
    }
  }

  async function restoreRejected(r: StagedPipelineRecord) {
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline-sync/${r.id}/restore`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const message = data.error ?? "Failed to restore record";
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      await load();
      notify("info", `Restored "${r.rawClientName}" to Needs Review`, "/pipeline-sync");
    } catch {
      const message = "Failed to restore record";
      setError(message);
      notify("error", message, "/pipeline-sync");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRecord(r: StagedPipelineRecord) {
    if (!confirm(`Delete "${r.rawClientName}"? You can restore it from Archives.`)) return;
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline-sync/${r.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const message = data.error ?? "Failed to delete record";
        setError(message);
        notify("error", message, "/pipeline-sync");
        return;
      }
      await load();
      notify("info", `Deleted "${r.rawClientName}" — restore it from Archives if needed`, "/archives");
    } catch {
      const message = "Failed to delete record";
      setError(message);
      notify("error", message, "/pipeline-sync");
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
        [r.contactName ?? "", r.contactEmail ?? "", r.notes ?? ""].some((field) => field.toLowerCase().includes(query))
        || Math.max(similarity(search.trim(), r.rawClientName), similarity(search.trim(), r.projectName)) >= EXISTENCE_THRESHOLD
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
  const allGreen = panelResult && panelResult.stages.contractMatch.found && panelResult.stages.proposalMatch.found && panelResult.stages.budgetMatch.found;

  const sharepointRecords = filtered.filter((r) => r.source === "sharepoint");
  const notionRecords = filtered.filter((r) => r.source === "notion");

  function renderRecordCard(r: StagedPipelineRecord) {
    const pending = r.status === "auto_linked" || r.status === "needs_review";
    const { contractCount, proposalCount, budgetCount } = existenceCounts(r.rawClientName, contracts, proposals, budgets);
    return (
      <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
              {pending && (
                <span className="text-xs text-stone-400">{t("pipeline_sync_confidence").replace("{pct}", (r.matchConfidence * 100).toFixed(0))}</span>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  proposalCount > 0 || budgetCount > 0 || contractCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"
                }`}
                title="Existing proposals/budgets/contracts fuzzy-matched by client name"
              >
                {proposalCount > 0 || budgetCount > 0 || contractCount > 0
                  ? `${proposalCount} proposal${proposalCount === 1 ? "" : "s"} · ${budgetCount} budget${budgetCount === 1 ? "" : "s"} · ${contractCount} contract${contractCount === 1 ? "" : "s"}`
                  : "No proposal, budget, or contract yet"}
              </span>
            </div>
            <p className="mt-1 font-medium text-stone-900">
              <span className="mr-1 font-normal text-stone-400">Client:</span>
              {r.rawClientName}
            </p>
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
        </div>

        <div className="mt-3 flex justify-between gap-2 border-t border-stone-100 pt-3">
          <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => deleteRecord(r)}>
            Delete
          </Button>
          <div className="flex gap-2">
            {r.status === "rejected" && (
              <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => restoreRejected(r)}>
                Undo Reject
              </Button>
            )}
            {pending && (
              <>
                <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => reject(r)}>
                  {t("pipeline_sync_reject")}
                </Button>
                <Button variant="primary" size="sm" loading={busyId === r.id} onClick={() => openValidation(r)}>
                  {t("pipeline_sync_validate")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!compact && <PageHeader title={t("nav_pipeline_sync")} subtitle={t("pipeline_sync_subtitle")} />}

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

      {query.length >= 2 && (
        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-stone-500">
            Live SharePoint search {sharePointSearching && "— searching…"}
          </p>
          {sharePointError ? (
            <p className="text-xs text-red-600">{sharePointError}</p>
          ) : sharePointResults === null ? (
            <p className="text-xs text-stone-400">…</p>
          ) : sharePointResults.length === 0 ? (
            <p className="text-xs text-stone-400">Nothing in SharePoint matches &ldquo;{search.trim()}&rdquo;.</p>
          ) : (
            <ul className="space-y-1">
              {sharePointResults.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span>{r.isFolder ? "📁" : "📄"}</span>
                  {r.webUrl ? (
                    <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">
                      {r.name}
                    </a>
                  ) : (
                    <span className="font-medium text-stone-700">{r.name}</span>
                  )}
                  <span className="text-stone-400">{r.parentPath}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 border-b border-stone-200">
          {(
            [
              { key: "sharepoint" as const, label: "SharePoint", count: sharepointRecords.length },
              { key: "notion" as const, label: "Notion", count: notionRecords.length },
            ]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setSourceTab(key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                sourceTab === key
                  ? "border-[#1a3d2b] text-[#1a3d2b]"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sourceTab === key ? "bg-[#1a3d2b]/10 text-[#1a3d2b]" : "bg-stone-100 text-stone-500"}`}>{count}</span>
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={syncing === sourceTab}
          onClick={() => runSync(sourceTab)}
          icon={<RefreshIcon />}
        >
          {sourceTab === "sharepoint" ? t("pipeline_sync_run_sharepoint") : t("pipeline_sync_run_notion")}
        </Button>
      </div>

      {sourceTab === "sharepoint" && lastScan && (
        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-stone-600">
            10_Pipeline sync results ({lastScan.length})
          </p>
          {lastScan.length === 0 ? (
            <p className="text-xs text-stone-400">No files found in the folder.</p>
          ) : (
            <ul className="space-y-1">
              {lastScan.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className={s.skipped ? "text-stone-400" : "text-emerald-600"}>{s.skipped ? "○" : "✓"}</span>
                  <span className="font-medium text-stone-700">{s.file}</span>
                  <span className="text-stone-400">
                    {s.skipped ? s.skipped : `extracted ${s.extracted} record${s.extracted === 1 ? "" : "s"}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : (sourceTab === "sharepoint" ? sharepointRecords : notionRecords).length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-8 text-center">
          <p className="text-sm text-stone-400">{t("pipeline_sync_empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">{(sourceTab === "sharepoint" ? sharepointRecords : notionRecords).map(renderRecordCard)}</div>
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
                <p className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-0.5">
                  {t("validate_panel_title")} · {SOURCE_LABEL[validationPanel.record.source]}
                </p>
                <h2 className="text-base font-semibold text-stone-900">
                  <span className="mr-1 font-normal text-stone-400">{t("validate_client_label")}</span>
                  {validationPanel.record.rawClientName}
                </h2>
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
                  ? t("validate_all_passed")
                  : t("validate_needs_review")}
              </div>
            )}

            {/* Stage cards */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {validationPanel.loading ? (
                <div className="flex items-center justify-center py-16 text-sm text-stone-400">
                  {t("validate_running")}
                </div>
              ) : panelResult ? (
                <div>
                  {/* Stage 1: Contract match */}
                  <ValidationStage
                    number={1}
                    title={t("validate_stage2_title")}
                    subtitle={t("validate_stage_subtitle_match")}
                    pass={panelResult.stages.contractMatch.found && (panelResult.stages.contractMatch.amountClose.close || panelResult.stages.contractMatch.amountClose.diffPct === null)}
                    warn={panelResult.stages.contractMatch.found && panelResult.stages.contractMatch.amountClose.diffPct !== null && !panelResult.stages.contractMatch.amountClose.close}
                    lines={(() => {
                      const c = panelResult.stages.contractMatch;
                      if (!c.found) return [t("validate_stage2_fail")];
                      const lines = [
                        t("validate_matched").replace("{name}", c.contract!.projectName).replace("{score}", String(c.contract!.score)),
                        c.contract!.expectedMonthlyAmount
                          ? t("validate_expected_amount").replace("{currency}", c.contract!.currency).replace("{amount}", c.contract!.expectedMonthlyAmount.toLocaleString())
                          : "",
                        c.amountClose.diffPct !== null
                          ? c.amountClose.close
                            ? t("validate_amount_within").replace("{pct}", String(c.amountClose.diffPct))
                            : t("validate_amount_differs").replace("{pct}", String(c.amountClose.diffPct))
                          : "",
                        c.linkMissing && c.suggestedLink
                          ? t("validate_possible_match_found").replace("{name}", c.suggestedLink.name).replace("{pct}", String(Math.round(c.suggestedLink.score * 100)))
                          : c.linkMissing ? t("validate_no_link_contract") : "",
                        c.linkMissing && c.linkDebug ? c.linkDebug : "",
                      ].filter(Boolean);
                      return lines;
                    })()}
                    links={[
                      ...panelResult.stages.contractMatch.allMatches.map((m) => ({
                        url: m.url,
                        label: `${t("validate_view_contract")} (${m.name})`,
                      })),
                      ...(panelResult.stages.contractMatch.linkMissing && panelResult.stages.contractMatch.suggestedLink
                        ? [{ url: panelResult.stages.contractMatch.suggestedLink.url, label: t("validate_view_possible_match").replace("{name}", panelResult.stages.contractMatch.suggestedLink.name) }]
                        : []),
                    ]}
                  />

                  {/* Stage 2: Proposal match */}
                  <ValidationStage
                    number={2}
                    title={t("validate_stage3_title")}
                    subtitle={t("validate_stage_subtitle_match")}
                    pass={panelResult.stages.proposalMatch.found && (panelResult.stages.proposalMatch.amountClose.close || panelResult.stages.proposalMatch.amountClose.diffPct === null)}
                    warn={panelResult.stages.proposalMatch.found && panelResult.stages.proposalMatch.amountClose.diffPct !== null && !panelResult.stages.proposalMatch.amountClose.close}
                    lines={(() => {
                      const p = panelResult.stages.proposalMatch;
                      if (!p.found) return [t("validate_stage3_fail")];
                      const lines = [
                        t("validate_matched").replace("{name}", p.proposal!.projectName).replace("{score}", String(p.proposal!.score)),
                        p.proposal!.estimatedAmount
                          ? t("validate_proposed_amount").replace("{currency}", p.proposal!.currency).replace("{amount}", p.proposal!.estimatedAmount.toLocaleString())
                          : "",
                        p.amountClose.diffPct !== null
                          ? p.amountClose.close
                            ? t("validate_amount_within_proposal").replace("{pct}", String(p.amountClose.diffPct))
                            : t("validate_amount_differs_proposal").replace("{pct}", String(p.amountClose.diffPct))
                          : "",
                        p.linkMissing && p.suggestedLink
                          ? t("validate_possible_match_found").replace("{name}", p.suggestedLink.name).replace("{pct}", String(Math.round(p.suggestedLink.score * 100)))
                          : p.linkMissing ? t("validate_no_link_proposal") : "",
                        p.linkMissing && p.linkDebug ? p.linkDebug : "",
                      ].filter(Boolean);
                      return lines;
                    })()}
                    links={[
                      ...panelResult.stages.proposalMatch.allMatches.map((m) => ({
                        url: m.url,
                        label: `${t("validate_view_proposal")} (${m.name})`,
                      })),
                      ...(panelResult.stages.proposalMatch.linkMissing && panelResult.stages.proposalMatch.suggestedLink
                        ? [{ url: panelResult.stages.proposalMatch.suggestedLink.url, label: t("validate_view_possible_match").replace("{name}", panelResult.stages.proposalMatch.suggestedLink.name) }]
                        : []),
                    ]}
                  />

                  {/* Stage 3: Budget match */}
                  <ValidationStage
                    number={3}
                    title={t("validate_stage4_title")}
                    subtitle={t("validate_stage_subtitle_match")}
                    pass={panelResult.stages.budgetMatch.found && (panelResult.stages.budgetMatch.amountClose.close || panelResult.stages.budgetMatch.amountClose.diffPct === null)}
                    warn={panelResult.stages.budgetMatch.found && panelResult.stages.budgetMatch.amountClose.diffPct !== null && !panelResult.stages.budgetMatch.amountClose.close}
                    lines={(() => {
                      const b = panelResult.stages.budgetMatch;
                      if (!b.found) return [t("validate_stage4_fail")];
                      const lines = [
                        t("validate_matched").replace("{name}", b.budget!.projectName).replace("{score}", String(b.budget!.score)),
                        b.budget!.budgetAmount
                          ? t("validate_budgeted_amount").replace("{currency}", b.budget!.currency).replace("{amount}", b.budget!.budgetAmount.toLocaleString())
                          : "",
                        b.amountClose.diffPct !== null
                          ? b.amountClose.close
                            ? t("validate_amount_within_budget").replace("{pct}", String(b.amountClose.diffPct))
                            : t("validate_amount_differs_budget").replace("{pct}", String(b.amountClose.diffPct))
                          : "",
                        b.linkMissing && b.suggestedLink
                          ? t("validate_possible_match_found").replace("{name}", b.suggestedLink.name).replace("{pct}", String(Math.round(b.suggestedLink.score * 100)))
                          : b.linkMissing ? t("validate_no_link_budget") : "",
                        b.linkMissing && b.linkDebug ? b.linkDebug : "",
                      ].filter(Boolean);
                      return lines;
                    })()}
                    links={[
                      ...panelResult.stages.budgetMatch.allMatches.map((m) => ({
                        url: m.url,
                        label: `${t("validate_view_budget")} (${m.name})`,
                      })),
                      ...(panelResult.stages.budgetMatch.linkMissing && panelResult.stages.budgetMatch.suggestedLink
                        ? [{ url: panelResult.stages.budgetMatch.suggestedLink.url, label: t("validate_view_possible_match").replace("{name}", panelResult.stages.budgetMatch.suggestedLink.name) }]
                        : []),
                    ]}
                  />

                  {/* Stage 4: Proposal ↔ Contract cross-check */}
                  {(() => {
                    const cross = panelResult.stages.proposalContractCross;
                    if (!cross.applicable) {
                      return (
                        <ValidationStage
                          number={4}
                          title={t("validate_stage5_title")}
                          subtitle={t("validate_stage5_subtitle")}
                          pass={false}
                          warn={false}
                          lines={[t("validate_stage5_skipped")]}
                        />
                      );
                    }
                    const close = cross.amountClose?.close ?? false;
                    const diffPct = cross.amountClose?.diffPct ?? null;
                    return (
                      <ValidationStage
                        number={4}
                        title={t("validate_stage5_title")}
                        subtitle={t("validate_stage5_subtitle")}
                        pass={close}
                        warn={!close && diffPct !== null}
                        lines={[
                          t("validate_proposal_amount_line").replace("{currency}", cross.currency).replace("{amount}", cross.proposalAmount?.toLocaleString() ?? "—"),
                          t("validate_contract_amount_line").replace("{currency}", cross.currency).replace("{amount}", cross.contractAmount?.toLocaleString() ?? "—"),
                          diffPct !== null
                            ? close
                              ? t("validate_amounts_match").replace("{pct}", String(diffPct))
                              : t("validate_amounts_differ").replace("{pct}", String(diffPct))
                            : t("validate_could_not_compare"),
                        ]}
                      />
                    );
                  })()}

                  {/* Stage 5: 3-way amount consistency (Proposal ↔ Contract ↔ Budget) */}
                  {(() => {
                    const tw = panelResult.stages.threeWayCross;
                    const fmtAmount = (v: number | null) => v != null ? v.toLocaleString() : "—";
                    if (!tw.applicable) {
                      return (
                        <ValidationStage
                          number={5}
                          title={t("validate_stage6_title")}
                          subtitle={t("validate_stage6_subtitle")}
                          pass={false}
                          warn={false}
                          lines={[t("validate_stage6_skipped")]}
                          isLast
                        />
                      );
                    }
                    const pairLine = (label: string, pair: { close: boolean; diffPct: number | null } | null) =>
                      pair == null ? "" : pair.diffPct === null
                        ? t("validate_pair_could_not_compare").replace("{label}", label)
                        : pair.close
                          ? t("validate_pair_within").replace("{label}", label).replace("{pct}", String(pair.diffPct))
                          : t("validate_pair_differs").replace("{label}", label).replace("{pct}", String(pair.diffPct));
                    return (
                      <ValidationStage
                        number={5}
                        title={t("validate_stage6_title")}
                        subtitle={t("validate_stage6_subtitle")}
                        pass={tw.allClose}
                        warn={!tw.allClose}
                        lines={[
                          t("validate_proposal_amount_line").replace("{currency}", tw.currency).replace("{amount}", fmtAmount(tw.proposalAmount)),
                          t("validate_contract_amount_line").replace("{currency}", tw.currency).replace("{amount}", fmtAmount(tw.contractAmount)),
                          t("validate_budget_amount_line").replace("{currency}", tw.currency).replace("{amount}", fmtAmount(tw.budgetAmount)),
                          pairLine(t("validate_pair_label_proposal_contract"), tw.proposalVsContract),
                          pairLine(t("validate_pair_label_proposal_budget"), tw.proposalVsBudget),
                          pairLine(t("validate_pair_label_contract_budget"), tw.contractVsBudget),
                        ].filter(Boolean)}
                        isLast
                      />
                    );
                  })()}
                </div>
              ) : (
                <p className="text-sm text-red-600">{t("validate_could_not_run")}</p>
              )}
            </div>

            {/* Footer actions */}
            <div className="border-t border-stone-100 px-6 py-4 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setValidationPanel(null)}>
                {t("validate_close")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Validation stage card ─────────────────────────────────────────────────────

function ValidationStage({
  number, title, subtitle, pass, warn, lines, links, isLast,
}: {
  number: number;
  title: string;
  subtitle: string;
  pass: boolean;
  warn: boolean;
  lines: string[];
  links?: { url: string; label: string }[];
  isLast?: boolean;
}) {
  const { t } = useLanguage();
  const status = warn ? "warn" : pass ? "pass" : "fail";
  const colors = {
    pass: { card: "bg-emerald-50 border-emerald-200", num: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: "✓", label: t("validate_badge_passed") },
    warn: { card: "bg-amber-50 border-amber-200",    num: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",   text: "text-amber-700",   icon: "⚠", label: t("validate_badge_review") },
    fail: { card: "bg-red-50 border-red-200",         num: "bg-red-500",     badge: "bg-red-100 text-red-700",       text: "text-red-700",     icon: "✕", label: t("validate_badge_not_found") },
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
        {links && links.length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-1">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1a3d2b] underline underline-offset-2 hover:opacity-75"
              >
                {l.label} →
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
