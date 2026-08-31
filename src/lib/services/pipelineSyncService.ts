// ─────────────────────────────────────────────────────────────────────────────
// lib/services/pipelineSyncService.ts — Notion + SharePoint pipeline sync
//
// Orchestrates: extract → map → stage → match → score → review → commit → log.
// Both sources are live once their credentials are configured, falling back
// to fixture data otherwise: SharePoint via real Graph API
// (pipelineSharePointSource.ts, needs AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET)
// and Notion via the real Notion API (pipelineNotionSource.ts, needs
// NOTION_TOKEN/NOTION_PIPELINE_DATABASE_ID). Commits (approveStagedRecord) go through the
// getClientService()/getLeadService() factory, so approved records land
// wherever the app is actually configured to store Client/Lead data
// (Supabase in production) — nothing commits to real data without a human
// approving it first via the staged-record review queue.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import type {
  PipelineSourceType,
  PipelineRecordStatus,
  StagedPipelineRecord,
  PipelineSyncAuditEntry,
  Client,
  Lead,
} from "@/types";
import { generateId } from "@/lib/utils";
import { getClientService, getLeadService } from "@/lib/services";
import { extractPipelineRecordsFromText, type ExtractedPipelineItem } from "@/lib/services/ai/pipelineExtraction";
import { rankClientCandidates, AUTO_LINK_THRESHOLD, similarity } from "@/lib/services/ai/pipelineMatching";
import { getMockNotionRawText, getMockSharePointPipelineRecords } from "@/lib/services/mock/pipelineSources";
import { fetchRealSharePointPipelineItems, fetchClientFolderPipelineItems } from "@/lib/services/real/pipelineSharePointSource";
import { fetchRealNotionPipelineItems } from "@/lib/services/real/pipelineNotionSource";
import {
  loadStagedPipelineRecords,
  saveStagedPipelineRecord,
  appendPipelineAuditEntry,
  loadPipelineAuditLog,
} from "@/lib/services/pipelineSyncStore";

async function audit(entry: Omit<PipelineSyncAuditEntry, "id" | "timestamp">): Promise<void> {
  await appendPipelineAuditEntry({
    id: generateId("padt"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

/** Whether each source currently has live credentials configured, for UI display. */
export function getSourceConnectionStatus(): Record<PipelineSourceType, "real" | "mock"> {
  const hasNotion = !!(process.env.NOTION_TOKEN && process.env.NOTION_PIPELINE_DATABASE_ID);
  const hasAzure = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
  return { notion: hasNotion ? "real" : "mock", sharepoint: hasAzure ? "real" : "mock" };
}

async function getSourceItems(source: PipelineSourceType): Promise<ExtractedPipelineItem[]> {
  if (source === "notion") {
    // Notion: use the real database once its credentials are configured,
    // falling back to fixture page text otherwise (e.g. local dev without a token).
    const hasNotionCreds = !!(process.env.NOTION_TOKEN && process.env.NOTION_PIPELINE_DATABASE_ID);
    if (!hasNotionCreds) {
      await audit({
        actor: "system",
        action: "extract",
        recordId: null,
        source,
        detail: "NOTION_TOKEN/NOTION_PIPELINE_DATABASE_ID not configured — using fixture Notion data.",
      });
      const rawText = getMockNotionRawText();
      return extractPipelineRecordsFromText(rawText).catch((err) => {
        console.warn("[pipelineSyncService] Notion extraction failed:", err);
        return [];
      });
    }

    const { items, scan } = await fetchRealNotionPipelineItems();
    await audit({
      actor: "system",
      action: "extract",
      recordId: null,
      source,
      detail: `Queried ${scan.pagesFound} page(s) from real Notion database (${scan.batches} extraction batch(es)), extracted ${items.length} record(s).` +
        (scan.timedOutBatches > 0 ? ` WARNING: ${scan.timedOutBatches} batch(es) did not respond within the per-batch timeout and were skipped this run — re-running the sync may pick them up if they're just momentarily slow.` : ""),
    });
    return items;
  }
  // SharePoint: use the real site once Azure creds are configured, falling
  // back to fixture data otherwise (e.g. local dev without Graph credentials).
  const hasAzureCreds = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
  if (!hasAzureCreds) {
    await audit({
      actor: "system",
      action: "extract",
      recordId: null,
      source,
      detail: "AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET not configured — using fixture SharePoint data.",
    });
    return getMockSharePointPipelineRecords();
  }

  // The dedicated pipeline tracker folder (fetchRealSharePointPipelineItems)
  // is scanned alongside each client's own WorkTogether folder
  // (fetchClientFolderPipelineItems) — the tracker turned out to hold
  // nothing usable (a shortcut, not real data) in practice, so client
  // folders are the resilient source. Same pattern as /api/proposals/sync.
  const [trackerResult, clientFolderResult] = await Promise.all([
    fetchRealSharePointPipelineItems(),
    fetchClientFolderPipelineItems(),
  ]);
  const items = dedupeExtractedItems([...trackerResult.items, ...clientFolderResult.items]);
  const scan = [...trackerResult.scan, ...clientFolderResult.scan];
  await audit({
    actor: "system",
    action: "extract",
    recordId: null,
    source,
    detail: `Scanned ${scan.length} file(s) in real SharePoint, extracted ${items.length} record(s). ` +
      scan.filter((s) => s.skipped).map((s) => `[${s.file}: ${s.skipped}]`).join(" "),
  });
  return items;
}

export interface RunSyncResult {
  staged: number;
  autoLinked: number;
  needsReview: number;
}

// Client identity is the anchor — a company's name extracts consistently
// run to run. Project/description text is free-form and the LLM reworks it
// more (e.g. "RPA開発支援" vs a slightly different phrasing next run), so
// requiring it to *also* clear a similarity bar (as this used to) let a
// client name match get dragged below threshold by project wording alone,
// causing the same client to restage as "new" on almost every re-sync.
const CLIENT_MATCH_THRESHOLD = 0.75;
// Only consulted to disambiguate when a client genuinely has more than one
// open deal staged — kept low since it's a tiebreaker, not a gate.
const PROJECT_TIEBREAK_THRESHOLD = 0.3;

// Extraction has no stable per-item id to key off, and re-running the same
// source through the LLM doesn't reproduce byte-identical text. Identity is
// fuzzy: find existing records (same source) whose client name is a strong
// match: one such record and no other consideration needed, multiple such
// records fall back to project-name similarity to pick the right one.
// Matching runs synchronously and up front (not inside the concurrent save
// loop below) so two new items can't both claim the same existing record.
function matchExistingRecords(
  source: PipelineSourceType,
  items: ExtractedPipelineItem[],
  existing: StagedPipelineRecord[]
): Array<StagedPipelineRecord | undefined> {
  const candidates = existing.filter((r) => r.source === source);
  const claimed = new Set<string>();
  return items.map((item) => {
    const clientMatches = candidates
      .filter((r) => !claimed.has(r.id) && similarity(item.rawClientName, r.rawClientName) >= CLIENT_MATCH_THRESHOLD);

    let best: StagedPipelineRecord | undefined;
    if (clientMatches.length === 1) {
      best = clientMatches[0];
    } else if (clientMatches.length > 1) {
      let bestScore = 0;
      for (const r of clientMatches) {
        const projectScore = similarity(item.projectName, r.projectName);
        if (projectScore >= PROJECT_TIEBREAK_THRESHOLD && projectScore > bestScore) {
          bestScore = projectScore;
          best = r;
        }
      }
    }

    if (best) claimed.add(best.id);
    return best;
  });
}

// SharePoint pipeline items now come from two scans merged together (the
// tracker folder + each client's own project folder) — collapse items that
// clearly describe the same client before they ever reach matchExistingRecords,
// so a client showing up in both scans doesn't stage as two new records in
// the same run (matchExistingRecords only guards against *prior* runs).
function dedupeExtractedItems(items: ExtractedPipelineItem[]): ExtractedPipelineItem[] {
  const kept: ExtractedPipelineItem[] = [];
  for (const item of items) {
    const isDuplicate = kept.some((k) => similarity(item.rawClientName, k.rawClientName) >= CLIENT_MATCH_THRESHOLD);
    if (!isDuplicate) kept.push(item);
  }
  return kept;
}

/** Pull, extract (if needed), match, score, and stage records from one source. */
export async function runPipelineSync(
  source: PipelineSourceType,
  actorName: string
): Promise<RunSyncResult> {
  const items = await getSourceItems(source);
  const clients = await getClientService().listClients();
  const existing = await loadStagedPipelineRecords();
  const itemMatches = matchExistingRecords(source, items, existing);
  const now = new Date().toISOString();

  // Each record's match + stage + audit-log write is independent of every
  // other record — running them concurrently instead of one-at-a-time in a
  // for-loop is what keeps a sync with 100+ records from summing 150+
  // sequential DB round-trips into a 504 (see PR history: this was the real
  // bottleneck even after extraction itself was already fixed).
  const statuses = await Promise.all(
    items.map(async (item, index) => {
      const match = itemMatches[index];

      // Already a human decision on this one (lead created, or explicitly
      // rejected) — leave it alone instead of restaging or overwriting it.
      if (match && (match.status === "approved" || match.status === "rejected")) {
        return match.status;
      }

      const candidates = rankClientCandidates(item.rawClientName, clients);
      const top = candidates[0];
      const status: PipelineRecordStatus =
        top && top.score >= AUTO_LINK_THRESHOLD ? "auto_linked" : "needs_review";

      const record: StagedPipelineRecord = {
        id: match?.id ?? generateId("pipe"),
        source,
        sourceRef: match?.sourceRef ?? `${source}-${index}`,
        rawClientName: item.rawClientName,
        projectName: item.projectName,
        stageOrStatus: item.stageOrStatus,
        estimatedAmount: item.estimatedAmount,
        currency: item.currency,
        contactName: item.contactName,
        contactEmail: item.contactEmail,
        notes: item.notes,
        matchedClientId: status === "auto_linked" ? top.clientId : null,
        matchedClientName: status === "auto_linked" ? top.clientName : null,
        matchConfidence: top?.score ?? 0,
        matchCandidates: candidates,
        status,
        reviewerComment: null,
        createdLeadId: null,
        createdAt: match?.createdAt ?? now,
        updatedAt: now,
      };
      await saveStagedPipelineRecord(record);

      await audit({
        actor: "system",
        action: "match",
        recordId: record.id,
        source,
        detail: top
          ? `${match ? "Re-matched" : "Matched"} "${item.rawClientName}" → "${top.clientName}" (score ${top.score.toFixed(2)}) → ${status}`
          : `No candidate match for "${item.rawClientName}" → needs_review`,
      });

      return status;
    })
  );

  const autoLinked = statuses.filter((s) => s === "auto_linked").length;
  const needsReview = statuses.filter((s) => s === "needs_review").length;

  await audit({
    actor: actorName,
    action: "sync",
    recordId: null,
    source,
    detail: `Sync run: ${items.length} staged, ${autoLinked} auto-linked, ${needsReview} needs review.`,
  });

  return { staged: items.length, autoLinked, needsReview };
}

export async function listStagedRecords(filters?: {
  status?: PipelineRecordStatus;
  source?: PipelineSourceType;
}): Promise<StagedPipelineRecord[]> {
  let all = await loadStagedPipelineRecords();
  if (filters?.status) all = all.filter((r) => r.status === filters.status);
  if (filters?.source) all = all.filter((r) => r.source === filters.source);
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function mapStageOrStatusToLeadStage(stageOrStatus: string): Lead["stage"] {
  const s = stageOrStatus.toLowerCase();
  if (/won|signed|accepted/.test(s)) return "won";
  if (/lost|declined|rejected/.test(s)) return "lost";
  if (/negotiat/.test(s)) return "negotiation";
  if (/proposal/.test(s)) return "proposal_sent";
  if (/qualif/.test(s)) return "qualified";
  if (/contact|talk/.test(s)) return "contacted";
  return "new";
}

/**
 * Approve a staged record: link (or create) the client, learn the alias,
 * create a lead from it, and mark the record committed.
 */
export async function approveStagedRecord(
  id: string,
  actorName: string,
  overrideClientId?: string
): Promise<StagedPipelineRecord> {
  const record = (await loadStagedPipelineRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged pipeline record "${id}" not found`);
  if (record.status === "approved" || record.status === "rejected") {
    throw new Error(`Record "${id}" already ${record.status}`);
  }

  const clientService = getClientService();
  const leadService = getLeadService();
  const now = new Date().toISOString();

  let client: Client | null = null;
  const targetClientId = overrideClientId ?? record.matchedClientId;

  if (targetClientId) {
    client = await clientService.getClient(targetClientId);
  }

  if (!client) {
    // No match (or override pointed at nothing) — create a new client record.
    client = {
      id: generateId("cli"),
      name: record.rawClientName,
      legalName: "",
      industry: "",
      contactName: record.contactName ?? "",
      contactEmail: record.contactEmail ?? "",
      contactPhone: "",
      address: "",
      country: "JP",
      taxRegistrationNumber: "",
      status: "prospect",
      notes: `Created from ${record.source} pipeline sync.`,
      aliases: [],
      createdAt: now,
      updatedAt: now,
    };
    await clientService.saveClient(client);
    await audit({
      actor: actorName,
      action: "approve",
      recordId: record.id,
      source: record.source,
      detail: `Created new client "${client.name}" (${client.id}).`,
    });
  } else {
    // Alias learning: remember this raw name for next time, if it isn't
    // already the canonical name or a known alias.
    const knownNames = new Set([client.name, ...(client.aliases ?? [])]);
    if (!knownNames.has(record.rawClientName)) {
      client = { ...client, aliases: [...(client.aliases ?? []), record.rawClientName], updatedAt: now };
      await clientService.saveClient(client);
      await audit({
        actor: actorName,
        action: "approve",
        recordId: record.id,
        source: record.source,
        detail: `Learned alias "${record.rawClientName}" for client "${client.name}" (${client.id}).`,
      });
    }
  }

  const lead: Lead = {
    id: generateId("lead"),
    clientId: client.id,
    clientName: client.name,
    contactName: record.contactName ?? "",
    contactEmail: record.contactEmail ?? "",
    source: record.source === "notion" ? "referral" : "inbound",
    stage: mapStageOrStatusToLeadStage(record.stageOrStatus),
    title: record.projectName || `Pipeline sync — ${client.name}`,
    estimatedValue: record.estimatedAmount ?? 0,
    currency: record.currency,
    probability: 0,
    expectedCloseDate: "",
    assignedTo: "",
    proposalId: null,
    notes: `Imported via ${record.source} pipeline sync (source ref: ${record.sourceRef}).${record.notes ? ` ${record.notes}` : ""}`,
    lostReason: "",
    createdAt: now,
    updatedAt: now,
  };
  await leadService.saveLead(lead);

  const updated: StagedPipelineRecord = {
    ...record,
    status: "approved",
    matchedClientId: client.id,
    matchedClientName: client.name,
    createdLeadId: lead.id,
    updatedAt: now,
  };
  await saveStagedPipelineRecord(updated);

  await audit({
    actor: actorName,
    action: "approve",
    recordId: record.id,
    source: record.source,
    detail: `Created lead "${lead.title}" (${lead.id}) linked to client "${client.name}" (${client.id}).`,
  });

  return updated;
}

export async function rejectStagedRecord(
  id: string,
  actorName: string,
  reason: string
): Promise<StagedPipelineRecord> {
  const record = (await loadStagedPipelineRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged pipeline record "${id}" not found`);

  const updated: StagedPipelineRecord = {
    ...record,
    status: "rejected",
    reviewerComment: reason,
    updatedAt: new Date().toISOString(),
  };
  await saveStagedPipelineRecord(updated);

  await audit({
    actor: actorName,
    action: "reject",
    recordId: record.id,
    source: record.source,
    detail: `Rejected: ${reason}`,
  });

  return updated;
}

/**
 * Undo a rejection, putting a record back into the review queue. Rejected
 * (and approved) records are deliberately skipped by matchExistingRecords
 * on every future sync — a human decision shouldn't get silently overwritten
 * by a re-extraction — but that also means a rejected record is otherwise
 * frozen forever, including from picking up later extraction-quality fixes
 * (e.g. improved amount-finding). This is the escape hatch: only valid from
 * "rejected", since "approved" already created a real Lead elsewhere that
 * reverting this record's status wouldn't undo.
 */
export async function restoreRejectedRecord(id: string, actorName: string): Promise<StagedPipelineRecord> {
  const record = (await loadStagedPipelineRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged pipeline record "${id}" not found`);
  if (record.status !== "rejected") {
    throw new Error(`Record "${id}" is "${record.status}", not rejected — nothing to restore`);
  }

  const updated: StagedPipelineRecord = {
    ...record,
    status: "needs_review",
    reviewerComment: null,
    updatedAt: new Date().toISOString(),
  };
  await saveStagedPipelineRecord(updated);

  await audit({
    actor: actorName,
    action: "restore",
    recordId: record.id,
    source: record.source,
    detail: "Restored from rejected back to needs_review.",
  });

  return updated;
}

export async function getAuditLog(recordId?: string): Promise<PipelineSyncAuditEntry[]> {
  const all = await loadPipelineAuditLog(recordId);
  return all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
