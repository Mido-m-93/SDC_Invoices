import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IProposalService } from "../types";
import type { Proposal } from "@/types";

function toRow(p: Proposal): Record<string, unknown> {
  return {
    id: p.id,
    vendor_id: "",          // NOT NULL legacy column — kept empty, client_id is the real link
    client_id: p.clientId,
    client_name: p.clientName ?? null,
    lead_id: p.leadId ?? null,
    project_name: p.projectName,
    proposal_date: p.proposalDate,
    estimated_amount: p.estimatedAmount,
    currency: p.currency,
    description: p.description,
    status: p.status,
    contract_id: p.contractId ?? null,
    folder_url: p.folderUrl ?? null,
    verification: p.verification ?? null,
    source_file_id: p.sourceFileId ?? null,
    created_at: p.createdAt,
    deleted_at: p.deletedAt ?? null,
    deleted_by: p.deletedBy ?? null,
  };
}

function fromRow(row: Record<string, unknown>): Proposal {
  return {
    id: row.id as string,
    // handle legacy rows that stored vendor_id before the rename
    clientId: ((row.client_id ?? row.vendor_id) as string) ?? "",
    clientName: (row.client_name as string | null) ?? undefined,
    leadId: (row.lead_id as string | null) ?? undefined,
    projectName: row.project_name as string,
    proposalDate: row.proposal_date as string,
    estimatedAmount: row.estimated_amount as number,
    currency: row.currency as string,
    description: row.description as string,
    status: row.status as Proposal["status"],
    contractId: (row.contract_id as string | null) ?? undefined,
    folderUrl: (row.folder_url as string | null) ?? undefined,
    verification: (row.verification as Proposal["verification"]) ?? undefined,
    sourceFileId: (row.source_file_id as string | null) ?? undefined,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    deletedBy: (row.deleted_by as string | null) ?? undefined,
  };
}

export class SupabaseProposalService implements IProposalService {
  private get db() {
    return getSupabaseClient();
  }

  async listProposals(): Promise<Proposal[]> {
    const { data, error } = await this.db
      .from("proposals")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listProposals: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const { error } = await this.db
      .from("proposals")
      .upsert(toRow(proposal), { onConflict: "id" });
    if (error) throw new Error(`saveProposal: ${error.message}`);
  }

  // Soft delete — sets deleted_at/deleted_by instead of removing the row, so
  // it can be restored from the Archives page instead of being lost.
  async deleteProposal(id: string, deletedBy?: string): Promise<void> {
    const { error } = await this.db
      .from("proposals")
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy ?? null })
      .eq("id", id);
    if (error) throw new Error(`deleteProposal: ${error.message}`);
  }

  async restoreProposal(id: string): Promise<void> {
    const { error } = await this.db
      .from("proposals")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    if (error) throw new Error(`restoreProposal: ${error.message}`);
  }

  async listDeletedProposals(): Promise<Proposal[]> {
    const { data, error } = await this.db
      .from("proposals")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(`listDeletedProposals: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }
}
