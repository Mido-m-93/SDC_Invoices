// ─────────────────────────────────────────────────────────────────────────────
// lib/services/pipelineSyncService.ts — Notion + SharePoint pipeline sync
//
// Orchestrates: extract → map → stage → match → score → review → commit → log.
// Mock-only for now — sources are fixture data (no live Notion/SharePoint
// pipeline connection yet), AND commits deliberately go through
// MockClientService/MockLeadService directly rather than the getClientService()
// / getLeadService() factory. Those factory getters follow the app-wide
// NEXT_PUBLIC_USE_MOCK_STORAGE flag, which is "false" (real Supabase) in this
// project's .env.local — going through them here would write real client/lead
// rows while this feature is still being proven out. Once verified end-to-end,
// swap getMockNotionRawText()/getMockSharePointPipelineRecords() for real API
// calls and swap these two imports for the getClientService()/getLeadService()
// factory getters to start writing to whichever store the app is configured for.
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
import { MockClientService, MockLeadService } from "@/lib/services/mock";
import { extractPipelineRecordsFromText, type ExtractedPipelineItem } from "@/lib/services/ai/pipelineExtraction";
import { rankClientCandidates, AUTO_LINK_THRESHOLD } from "@/lib/services/ai/pipelineMatching";
import { getMockNotionRawText, getMockSharePointPipelineRecords } from "@/lib/services/mock/pipelineSources";
import {
  loadStagedPipelineRecords,
  saveStagedPipelineRecord,
  appendPipelineAuditEntry,
  loadPipelineAuditLog,
} from "@/lib/services/mock/fileStore";

function audit(entry: Omit<PipelineSyncAuditEntry, "id" | "timestamp">): void {
  appendPipelineAuditEntry({
    id: generateId("padt"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

async function getSourceItems(source: PipelineSourceType): Promise<ExtractedPipelineItem[]> {
  if (source === "notion") {
    const rawText = getMockNotionRawText();
    const items = await extractPipelineRecordsFromText(rawText);
    audit({
      actor: "system",
      action: "extract",
      recordId: null,
      source,
      detail: `Extracted ${items.length} record(s) from Notion page text via AI.`,
    });
    return items;
  }
  // SharePoint source is already tabular — no extraction pass needed.
  return getMockSharePointPipelineRecords();
}

export interface RunSyncResult {
  staged: number;
  autoLinked: number;
  needsReview: number;
}

/** Pull, extract (if needed), match, score, and stage records from one source. */
export async function runPipelineSync(
  source: PipelineSourceType,
  actorName: string
): Promise<RunSyncResult> {
  const items = await getSourceItems(source);
  const clients = await new MockClientService().listClients();

  let autoLinked = 0;
  let needsReview = 0;
  const now = new Date().toISOString();

  items.forEach((item, index) => {
    const candidates = rankClientCandidates(item.rawClientName, clients);
    const top = candidates[0];
    const status: PipelineRecordStatus =
      top && top.score >= AUTO_LINK_THRESHOLD ? "auto_linked" : "needs_review";

    if (status === "auto_linked") autoLinked++;
    else needsReview++;

    const record: StagedPipelineRecord = {
      id: generateId("pipe"),
      source,
      sourceRef: `${source}-${index}`,
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
      createdAt: now,
      updatedAt: now,
    };
    saveStagedPipelineRecord(record);

    audit({
      actor: "system",
      action: "match",
      recordId: record.id,
      source,
      detail: top
        ? `Matched "${item.rawClientName}" → "${top.clientName}" (score ${top.score.toFixed(2)}) → ${status}`
        : `No candidate match for "${item.rawClientName}" → needs_review`,
    });
  });

  audit({
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
  let all = loadStagedPipelineRecords();
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
  const record = loadStagedPipelineRecords().find((r) => r.id === id);
  if (!record) throw new Error(`Staged pipeline record "${id}" not found`);
  if (record.status === "approved" || record.status === "rejected") {
    throw new Error(`Record "${id}" already ${record.status}`);
  }

  const clientService = new MockClientService();
  const leadService = new MockLeadService();
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
    audit({
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
      audit({
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
  saveStagedPipelineRecord(updated);

  audit({
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
  const record = loadStagedPipelineRecords().find((r) => r.id === id);
  if (!record) throw new Error(`Staged pipeline record "${id}" not found`);

  const updated: StagedPipelineRecord = {
    ...record,
    status: "rejected",
    reviewerComment: reason,
    updatedAt: new Date().toISOString(),
  };
  saveStagedPipelineRecord(updated);

  audit({
    actor: actorName,
    action: "reject",
    recordId: record.id,
    source: record.source,
    detail: `Rejected: ${reason}`,
  });

  return updated;
}

export async function getAuditLog(recordId?: string): Promise<PipelineSyncAuditEntry[]> {
  return loadPipelineAuditLog(recordId).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
