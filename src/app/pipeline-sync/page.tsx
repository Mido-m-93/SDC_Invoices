"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import ClientPicker from "@/components/ui/ClientPicker";
import type { StagedPipelineRecord, PipelineRecordStatus, PipelineSourceType, Client } from "@/types";

const STATUS_LABELS: Record<PipelineRecordStatus, string> = {
  auto_linked: "Auto-linked",
  needs_review: "Needs Review",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<PipelineRecordStatus, string> = {
  auto_linked: "bg-emerald-50 text-emerald-700",
  needs_review: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
};

type Override = { clientId: string; clientName: string };

export default function PipelineSyncPage() {
  const [records, setRecords] = useState<StagedPipelineRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusFilter, setStatusFilter] = useState<PipelineRecordStatus | "all">("all");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<PipelineSourceType | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes] = await Promise.all([fetch("/api/pipeline-sync"), fetch("/api/pipeline-sync/clients")]);
      const rData = (await rRes.json()) as { records: StagedPipelineRecord[] };
      const cData = (await cRes.json()) as { clients: Client[] };
      setRecords(rData.records ?? []);
      setClients(cData.clients ?? []);
    } catch {
      setError("Failed to load pipeline sync data");
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
    try {
      const res = await fetch("/api/pipeline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await res.json()) as { error?: string; staged?: number; autoLinked?: number; needsReview?: number };
      if (!res.ok) { setError(data.error ?? "Sync failed"); return; }
      await load();
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(null);
    }
  }

  async function approve(r: StagedPipelineRecord) {
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
      if (!res.ok) { setError(data.error ?? "Approve failed"); return; }
      await load();
    } catch {
      setError("Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(r: StagedPipelineRecord) {
    const reason = prompt(`Reject "${r.rawClientName}" — reason?`);
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
      if (!res.ok) { setError(data.error ?? "Reject failed"); return; }
      await load();
    } catch {
      setError("Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = statusFilter === "all" ? records : records.filter((r) => r.status === statusFilter);
  const counts = {
    all: records.length,
    auto_linked: records.filter((r) => r.status === "auto_linked").length,
    needs_review: records.filter((r) => r.status === "needs_review").length,
    approved: records.filter((r) => r.status === "approved").length,
    rejected: records.filter((r) => r.status === "rejected").length,
  };

  return (
    <AppShell>
      <PageHeader
        title="Pipeline Sync"
        subtitle="Notion + SharePoint → AI matching → review queue"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" loading={syncing === "notion"} onClick={() => runSync("notion")}>
              Run Notion Sync
            </Button>
            <Button variant="secondary" loading={syncing === "sharepoint"} onClick={() => runSync("sharepoint")}>
              Run SharePoint Sync
            </Button>
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        <strong>Mock mode</strong> — sources are fixture data, and approving writes to mock storage only. No real Notion/SharePoint connection or production data is touched yet.
      </div>

      {error && (
        <div className="mb-4 flex justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "needs_review", "auto_linked", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s ? "border-[#1a3d2b] bg-[#1a3d2b] text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
            }`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusFilter === s ? "bg-white/20" : "bg-stone-100"}`}>{counts[s]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-stone-400">No staged records. Run a sync above to pull mock pipeline data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const override = overrideFor(r);
            const pending = r.status === "auto_linked" || r.status === "needs_review";
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
                        <span className="text-xs text-stone-400">confidence {(r.matchConfidence * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    <p className="mt-1 font-medium text-stone-900">{r.rawClientName}</p>
                    <p className="text-sm text-stone-500">{r.projectName || "—"} · {r.stageOrStatus}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {r.estimatedAmount ? `${r.currency} ${r.estimatedAmount.toLocaleString()}` : "No amount"}
                      {r.contactName ? ` · ${r.contactName}` : ""}
                    </p>
                    {r.status === "rejected" && r.reviewerComment && (
                      <p className="mt-1 text-xs text-red-600">Rejected: {r.reviewerComment}</p>
                    )}
                    {r.status === "approved" && (
                      <p className="mt-1 text-xs text-blue-600">
                        Linked to {r.matchedClientName} · lead {r.createdLeadId}
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
                      Reject
                    </Button>
                    <Button variant="primary" size="sm" loading={busyId === r.id} onClick={() => approve(r)}>
                      Approve & Create Lead
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
