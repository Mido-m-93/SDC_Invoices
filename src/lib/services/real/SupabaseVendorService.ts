import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IVendorService } from "../types";
import type { Vendor } from "@/types";

function toRow(v: Vendor): Record<string, unknown> {
  return {
    id: v.id,
    name: v.name,
    aliases: v.aliases,
    tax_registration_number: v.taxRegistrationNumber,
    bank_account_last4: v.bankAccountLast4,
    default_reviewer: v.defaultReviewer,
    default_project: v.defaultProject,
    status: v.status,
    created_at: v.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): Vendor {
  return {
    id: row.id as string,
    name: row.name as string,
    aliases: (row.aliases as string[]) ?? [],
    taxRegistrationNumber: row.tax_registration_number as string,
    bankAccountLast4: row.bank_account_last4 as string,
    defaultReviewer: row.default_reviewer as string,
    defaultProject: row.default_project as string,
    status: row.status as Vendor["status"],
    createdAt: row.created_at as string,
  };
}

export class SupabaseVendorService implements IVendorService {
  private get db() {
    return getSupabaseClient();
  }

  async listVendors(): Promise<Vendor[]> {
    const { data, error } = await this.db
      .from("vendors")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(`listVendors: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async saveVendor(vendor: Vendor): Promise<void> {
    const { error } = await this.db
      .from("vendors")
      .upsert(toRow(vendor), { onConflict: "id" });
    if (error) throw new Error(`saveVendor: ${error.message}`);
  }

  async deleteVendor(id: string): Promise<void> {
    const { error } = await this.db.from("vendors").delete().eq("id", id);
    if (error) throw new Error(`deleteVendor: ${error.message}`);
  }
}
