import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IContractService } from "../types";
import type { Contract } from "@/types";

function toRow(c: Contract): Record<string, unknown> {
  return {
    id: c.id,
    vendor_id: c.vendorId || null,  // null for client-only contracts (no vendor)
    client_id: c.clientId ?? null,
    client_name: c.clientName ?? null,
    project_name: c.projectName,
    start_date: c.startDate,
    end_date: c.endDate,
    expected_monthly_amount: c.expectedMonthlyAmount,
    currency: c.currency,
    payment_terms: c.paymentTerms,
    status: c.status,
    proposal_id: c.proposalId ?? null,
    budget_id: c.budgetId ?? null,
    contract_folder_url: c.contractFolderUrl ?? null,
    verification_proposal: c.verificationProposal ?? null,
    verification_budget: c.verificationBudget ?? null,
    reviewed_at: c.reviewedAt ?? null,
    reviewed_by: c.reviewedBy ?? null,
    billing_rules_checked: c.billingRulesChecked ?? false,
    billing_rules_checked_at: c.billingRulesCheckedAt ?? null,
    billing_rules_checked_by: c.billingRulesCheckedBy ?? null,
    created_at: c.createdAt,
    deleted_at: c.deletedAt ?? null,
    deleted_by: c.deletedBy ?? null,
  };
}

function fromRow(row: Record<string, unknown>): Contract {
  return {
    id: row.id as string,
    vendorId: row.vendor_id as string,
    clientId: (row.client_id as string | null) ?? undefined,
    clientName: (row.client_name as string | null) ?? undefined,
    projectName: row.project_name as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    expectedMonthlyAmount: row.expected_monthly_amount as number,
    currency: row.currency as string,
    paymentTerms: row.payment_terms as string,
    status: row.status as Contract["status"],
    proposalId: (row.proposal_id as string | null) ?? undefined,
    budgetId: (row.budget_id as string | null) ?? undefined,
    contractFolderUrl: (row.contract_folder_url as string | null) ?? undefined,
    verificationProposal: (row.verification_proposal as Contract["verificationProposal"]) ?? undefined,
    verificationBudget: (row.verification_budget as Contract["verificationBudget"]) ?? undefined,
    reviewedAt: (row.reviewed_at as string | null) ?? undefined,
    reviewedBy: (row.reviewed_by as string | null) ?? undefined,
    billingRulesChecked: (row.billing_rules_checked as boolean | null) ?? false,
    billingRulesCheckedAt: (row.billing_rules_checked_at as string | null) ?? undefined,
    billingRulesCheckedBy: (row.billing_rules_checked_by as string | null) ?? undefined,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    deletedBy: (row.deleted_by as string | null) ?? undefined,
  };
}

export class SupabaseContractService implements IContractService {
  private get db() {
    return getSupabaseClient();
  }

  async listContracts(): Promise<Contract[]> {
    const { data, error } = await this.db
      .from("contracts")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listContracts: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async saveContract(contract: Contract): Promise<void> {
    const { error } = await this.db
      .from("contracts")
      .upsert(toRow(contract), { onConflict: "id" });
    if (error) throw new Error(`saveContract: ${error.message}`);
  }

  // Soft delete — sets deleted_at/deleted_by instead of removing the row, so
  // it can be restored from the Archives page instead of being lost.
  async deleteContract(id: string, deletedBy?: string): Promise<void> {
    const { error } = await this.db
      .from("contracts")
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy ?? null })
      .eq("id", id);
    if (error) throw new Error(`deleteContract: ${error.message}`);
  }

  async restoreContract(id: string): Promise<void> {
    const { error } = await this.db
      .from("contracts")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    if (error) throw new Error(`restoreContract: ${error.message}`);
  }

  async listDeletedContracts(): Promise<Contract[]> {
    const { data, error } = await this.db
      .from("contracts")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(`listDeletedContracts: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }
}
