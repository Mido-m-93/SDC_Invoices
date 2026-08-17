import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IClientService } from "../types";
import type { Client, ClientStatus } from "@/types";

function toRow(c: Client): Record<string, unknown> {
  return { id: c.id, name: c.name, legal_name: c.legalName, industry: c.industry, contact_name: c.contactName, contact_email: c.contactEmail, contact_phone: c.contactPhone, address: c.address, country: c.country, tax_registration_number: c.taxRegistrationNumber, status: c.status, notes: c.notes, created_at: c.createdAt, updated_at: c.updatedAt };
}

function fromRow(r: Record<string, unknown>): Client {
  return { id: r.id as string, name: r.name as string, legalName: r.legal_name as string, industry: r.industry as string, contactName: r.contact_name as string, contactEmail: r.contact_email as string, contactPhone: r.contact_phone as string, address: r.address as string, country: r.country as string, taxRegistrationNumber: r.tax_registration_number as string, status: r.status as Client["status"], notes: r.notes as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

export class SupabaseClientService implements IClientService {
  private get db() { return getSupabaseClient(); }

  async listClients(filters?: { status?: ClientStatus }): Promise<Client[]> {
    let q = this.db.from("clients").select("*").order("name", { ascending: true });
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw new Error(`listClients: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getClient(id: string): Promise<Client | null> {
    const { data, error } = await this.db.from("clients").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveClient(client: Client): Promise<void> {
    const { error } = await this.db.from("clients").upsert(toRow(client), { onConflict: "id" });
    if (error) throw new Error(`saveClient: ${error.message}`);
  }

  async deleteClient(id: string): Promise<void> {
    const { error } = await this.db.from("clients").delete().eq("id", id);
    if (error) throw new Error(`deleteClient: ${error.message}`);
  }
}
