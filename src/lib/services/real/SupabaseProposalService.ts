import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IProposalService } from "../types";
import type { Proposal } from "@/types";

function toRow(p: Proposal): Record<string, unknown> {
  return {
    id: p.id,
    vendor_id: p.vendorId,
    project_name: p.projectName,
    proposal_date: p.proposalDate,
    estimated_amount: p.estimatedAmount,
    currency: p.currency,
    description: p.description,
    status: p.status,
    contract_id: p.contractId ?? null,
    folder_url: p.folderUrl ?? null,
    created_at: p.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): Proposal {
  return {
    id: row.id as string,
    vendorId: row.vendor_id as string,
    projectName: row.project_name as string,
    proposalDate: row.proposal_date as string,
    estimatedAmount: row.estimated_amount as number,
    currency: row.currency as string,
    description: row.description as string,
    status: row.status as Proposal["status"],
    contractId: row.contract_id as string | undefined,
    folderUrl: row.folder_url as string | undefined,
    createdAt: row.created_at as string,
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

  async deleteProposal(id: string): Promise<void> {
    const { error } = await this.db.from("proposals").delete().eq("id", id);
    if (error) throw new Error(`deleteProposal: ${error.message}`);
  }
}
