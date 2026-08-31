import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type {
  StagedPipelineRecord,
  PipelineSyncAuditEntry,
  PipelineRecordStatus,
  PipelineSourceType,
} from "@/types";

function toStagedRow(r: StagedPipelineRecord): Record<string, unknown> {
  return {
    id: r.id,
    source: r.source,
    source_ref: r.sourceRef,
    raw_client_name: r.rawClientName,
    project_name: r.projectName,
    stage_or_status: r.stageOrStatus,
    estimated_amount: r.estimatedAmount,
    currency: r.currency,
    contact_name: r.contactName,
    contact_email: r.contactEmail,
    notes: r.notes,
    matched_client_id: r.matchedClientId,
    matched_client_name: r.matchedClientName,
    match_confidence: r.matchConfidence,
    match_candidates: r.matchCandidates,
    status: r.status,
    reviewer_comment: r.reviewerComment,
    created_lead_id: r.createdLeadId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt ?? null,
    deleted_by: r.deletedBy ?? null,
  };
}

function fromStagedRow(row: Record<string, unknown>): StagedPipelineRecord {
  return {
    id: row.id as string,
    source: row.source as PipelineSourceType,
    sourceRef: (row.source_ref as string) ?? "",
    rawClientName: row.raw_client_name as string,
    projectName: (row.project_name as string) ?? "",
    stageOrStatus: (row.stage_or_status as string) ?? "",
    estimatedAmount: (row.estimated_amount as number | null) ?? null,
    currency: (row.currency as string) ?? "JPY",
    contactName: (row.contact_name as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    matchedClientId: (row.matched_client_id as string | null) ?? null,
    matchedClientName: (row.matched_client_name as string | null) ?? null,
    matchConfidence: (row.match_confidence as number) ?? 0,
    matchCandidates: (row.match_candidates as StagedPipelineRecord["matchCandidates"]) ?? [],
    status: row.status as PipelineRecordStatus,
    reviewerComment: (row.reviewer_comment as string | null) ?? null,
    createdLeadId: (row.created_lead_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    deletedBy: (row.deleted_by as string | null) ?? undefined,
  };
}

function toAuditRow(e: PipelineSyncAuditEntry): Record<string, unknown> {
  return {
    id: e.id,
    timestamp: e.timestamp,
    actor: e.actor,
    action: e.action,
    record_id: e.recordId,
    source: e.source,
    detail: e.detail,
  };
}

function fromAuditRow(row: Record<string, unknown>): PipelineSyncAuditEntry {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    actor: row.actor as string,
    action: row.action as PipelineSyncAuditEntry["action"],
    recordId: (row.record_id as string | null) ?? null,
    source: (row.source as PipelineSourceType | null) ?? null,
    detail: (row.detail as string) ?? "",
  };
}

export async function loadStagedPipelineRecords(): Promise<StagedPipelineRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("staged_pipeline_records")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loadStagedPipelineRecords: ${error.message}`);
  return (data ?? []).map((r) => fromStagedRow(r as Record<string, unknown>));
}

export async function loadDeletedPipelineRecords(): Promise<StagedPipelineRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("staged_pipeline_records")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(`loadDeletedPipelineRecords: ${error.message}`);
  return (data ?? []).map((r) => fromStagedRow(r as Record<string, unknown>));
}

export async function saveStagedPipelineRecord(record: StagedPipelineRecord): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("staged_pipeline_records")
    .upsert(toStagedRow(record), { onConflict: "id" });
  if (error) throw new Error(`saveStagedPipelineRecord: ${error.message}`);
}

// Soft delete — sets deleted_at/deleted_by instead of removing the row, so
// it can be restored from the Archives page instead of being lost.
export async function softDeletePipelineRecord(id: string, deletedBy?: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("staged_pipeline_records")
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy ?? null })
    .eq("id", id);
  if (error) throw new Error(`softDeletePipelineRecord: ${error.message}`);
}

export async function restorePipelineRecordFromDelete(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("staged_pipeline_records")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", id);
  if (error) throw new Error(`restorePipelineRecordFromDelete: ${error.message}`);
}

export async function appendPipelineAuditEntry(entry: PipelineSyncAuditEntry): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("pipeline_sync_audit_log")
    .insert(toAuditRow(entry));
  if (error) throw new Error(`appendPipelineAuditEntry: ${error.message}`);
}

export async function loadPipelineAuditLog(recordId?: string): Promise<PipelineSyncAuditEntry[]> {
  let query = getSupabaseClient().from("pipeline_sync_audit_log").select("*").order("timestamp", { ascending: false });
  if (recordId) query = query.eq("record_id", recordId);
  const { data, error } = await query;
  if (error) throw new Error(`loadPipelineAuditLog: ${error.message}`);
  return (data ?? []).map((r) => fromAuditRow(r as Record<string, unknown>));
}
