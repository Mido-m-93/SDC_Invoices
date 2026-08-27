import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { StagedProposalRecord, StagedProposalStatus } from "@/types";

function toRow(r: StagedProposalRecord): Record<string, unknown> {
  return {
    id: r.id,
    file_id: r.fileId,
    file_name: r.fileName,
    folder: r.folder,
    raw_client_name: r.rawClientName,
    project_name: r.projectName,
    proposal_date: r.proposalDate,
    estimated_amount: r.estimatedAmount,
    currency: r.currency,
    match_candidates: r.matchCandidates,
    status: r.status,
    reviewer_comment: r.reviewerComment,
    created_proposal_id: r.createdProposalId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): StagedProposalRecord {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    fileName: row.file_name as string,
    folder: (row.folder as string) ?? "",
    rawClientName: (row.raw_client_name as string) ?? "",
    projectName: (row.project_name as string) ?? "",
    proposalDate: (row.proposal_date as string | null) ?? null,
    estimatedAmount: (row.estimated_amount as number | null) ?? null,
    currency: (row.currency as string) ?? "JPY",
    matchCandidates: (row.match_candidates as StagedProposalRecord["matchCandidates"]) ?? [],
    status: row.status as StagedProposalStatus,
    reviewerComment: (row.reviewer_comment as string | null) ?? null,
    createdProposalId: (row.created_proposal_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function loadStagedProposalRecords(): Promise<StagedProposalRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("staged_proposal_records")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loadStagedProposalRecords: ${error.message}`);
  return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
}

export async function findStagedProposalRecordByFileId(fileId: string): Promise<StagedProposalRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("staged_proposal_records")
    .select("*")
    .eq("file_id", fileId)
    .maybeSingle();
  if (error) throw new Error(`findStagedProposalRecordByFileId: ${error.message}`);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

export async function saveStagedProposalRecord(record: StagedProposalRecord): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("staged_proposal_records")
    .upsert(toRow(record), { onConflict: "id" });
  if (error) throw new Error(`saveStagedProposalRecord: ${error.message}`);
}
