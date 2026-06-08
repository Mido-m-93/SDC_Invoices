import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IContractService } from "../types";
import type { Contract } from "@/types";

function toRow(c: Contract): Record<string, unknown> {
  return {
    id: c.id,
    vendor_id: c.vendorId,
    project_name: c.projectName,
    start_date: c.startDate,
    end_date: c.endDate,
    expected_monthly_amount: c.expectedMonthlyAmount,
    currency: c.currency,
    payment_terms: c.paymentTerms,
    status: c.status,
    created_at: c.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): Contract {
  return {
    id: row.id as string,
    vendorId: row.vendor_id as string,
    projectName: row.project_name as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    expectedMonthlyAmount: row.expected_monthly_amount as number,
    currency: row.currency as string,
    paymentTerms: row.payment_terms as string,
    status: row.status as Contract["status"],
    createdAt: row.created_at as string,
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

  async deleteContract(id: string): Promise<void> {
    const { error } = await this.db.from("contracts").delete().eq("id", id);
    if (error) throw new Error(`deleteContract: ${error.message}`);
  }
}
