import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { StagedBudgetRecord, StagedBudgetStatus } from "@/types";

function toRow(r: StagedBudgetRecord): Record<string, unknown> {
  return {
    id: r.id,
    file_id: r.fileId,
    file_name: r.fileName,
    file_url: r.fileUrl,
    folder: r.folder,
    raw_client_name: r.rawClientName,
    project_name: r.projectName,
    budget_date: r.budgetDate,
    budget_amount: r.budgetAmount,
    currency: r.currency,
    match_candidates: r.matchCandidates,
    status: r.status,
    reviewer_comment: r.reviewerComment,
    created_budget_id: r.createdBudgetId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): StagedBudgetRecord {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    fileName: row.file_name as string,
    fileUrl: (row.file_url as string | null) ?? null,
    folder: (row.folder as string) ?? "",
    rawClientName: (row.raw_client_name as string) ?? "",
    projectName: (row.project_name as string) ?? "",
    budgetDate: (row.budget_date as string | null) ?? null,
    budgetAmount: (row.budget_amount as number | null) ?? null,
    currency: (row.currency as string) ?? "JPY",
    matchCandidates: (row.match_candidates as StagedBudgetRecord["matchCandidates"]) ?? [],
    status: row.status as StagedBudgetStatus,
    reviewerComment: (row.reviewer_comment as string | null) ?? null,
    createdBudgetId: (row.created_budget_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function loadStagedBudgetRecords(): Promise<StagedBudgetRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("staged_budget_records")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loadStagedBudgetRecords: ${error.message}`);
  return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
}

export async function findStagedBudgetRecordByFileId(fileId: string): Promise<StagedBudgetRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("staged_budget_records")
    .select("*")
    .eq("file_id", fileId)
    .maybeSingle();
  if (error) throw new Error(`findStagedBudgetRecordByFileId: ${error.message}`);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

export async function saveStagedBudgetRecord(record: StagedBudgetRecord): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("staged_budget_records")
    .upsert(toRow(record), { onConflict: "id" });
  if (error) throw new Error(`saveStagedBudgetRecord: ${error.message}`);
}
