import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IBudgetService } from "../types";
import type { Budget } from "@/types";

function toRow(b: Budget): Record<string, unknown> {
  return {
    id: b.id,
    client_id: b.clientId,
    client_name: b.clientName ?? null,
    proposal_id: b.proposalId ?? null,
    project_name: b.projectName,
    budget_amount: b.budgetAmount,
    currency: b.currency,
    budget_date: b.budgetDate,
    status: b.status,
    description: b.description,
    folder_url: b.folderUrl ?? null,
    verification_proposal: b.verificationProposal ?? null,
    source_file_id: b.sourceFileId ?? null,
    created_at: b.createdAt,
    deleted_at: b.deletedAt ?? null,
    deleted_by: b.deletedBy ?? null,
  };
}

function fromRow(row: Record<string, unknown>): Budget {
  return {
    id: row.id as string,
    clientId: (row.client_id as string) ?? "",
    clientName: (row.client_name as string | null) ?? undefined,
    proposalId: (row.proposal_id as string | null) ?? undefined,
    projectName: row.project_name as string,
    budgetAmount: row.budget_amount as number,
    currency: row.currency as string,
    budgetDate: row.budget_date as string,
    status: row.status as Budget["status"],
    description: row.description as string,
    folderUrl: (row.folder_url as string | null) ?? undefined,
    verificationProposal: (row.verification_proposal as Budget["verificationProposal"]) ?? undefined,
    sourceFileId: (row.source_file_id as string | null) ?? undefined,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    deletedBy: (row.deleted_by as string | null) ?? undefined,
  };
}

export class SupabaseBudgetService implements IBudgetService {
  private get db() {
    return getSupabaseClient();
  }

  async listBudgets(): Promise<Budget[]> {
    const { data, error } = await this.db
      .from("budgets")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listBudgets: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async saveBudget(budget: Budget): Promise<void> {
    const { error } = await this.db
      .from("budgets")
      .upsert(toRow(budget), { onConflict: "id" });
    if (error) throw new Error(`saveBudget: ${error.message}`);
  }

  // Soft delete — mirrors SupabaseProposalService so mock/real storage behave
  // the same for the Delete + Undo + Archives flow.
  async deleteBudget(id: string, deletedBy?: string): Promise<void> {
    const { error } = await this.db
      .from("budgets")
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy ?? null })
      .eq("id", id);
    if (error) throw new Error(`deleteBudget: ${error.message}`);
  }

  async restoreBudget(id: string): Promise<void> {
    const { error } = await this.db
      .from("budgets")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    if (error) throw new Error(`restoreBudget: ${error.message}`);
  }

  async listDeletedBudgets(): Promise<Budget[]> {
    const { data, error } = await this.db
      .from("budgets")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(`listDeletedBudgets: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }
}
