import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { ILeadService } from "../types";
import type { Lead, LeadStage, LeadSummary } from "@/types";

function toRow(l: Lead): Record<string, unknown> {
  return { id: l.id, client_id: l.clientId, client_name: l.clientName, contact_name: l.contactName, contact_email: l.contactEmail, source: l.source, stage: l.stage, title: l.title, estimated_value: l.estimatedValue, currency: l.currency, probability: l.probability, expected_close_date: l.expectedCloseDate, assigned_to: l.assignedTo, proposal_id: l.proposalId ?? null, notes: l.notes, lost_reason: l.lostReason, created_at: l.createdAt, updated_at: l.updatedAt };
}

function fromRow(r: Record<string, unknown>): Lead {
  return { id: r.id as string, clientId: r.client_id as string, clientName: r.client_name as string, contactName: r.contact_name as string, contactEmail: r.contact_email as string, source: r.source as Lead["source"], stage: r.stage as LeadStage, title: r.title as string, estimatedValue: r.estimated_value as number, currency: r.currency as string, probability: r.probability as number, expectedCloseDate: r.expected_close_date as string, assignedTo: r.assigned_to as string, proposalId: r.proposal_id as string | null, notes: r.notes as string, lostReason: r.lost_reason as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

export class SupabaseLeadService implements ILeadService {
  private get db() { return getSupabaseClient(); }

  async listLeads(filters?: { stage?: LeadStage; assignedTo?: string; clientId?: string }): Promise<Lead[]> {
    let q = this.db.from("leads").select("*").order("created_at", { ascending: false });
    if (filters?.stage) q = q.eq("stage", filters.stage);
    if (filters?.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
    if (filters?.clientId) q = q.eq("client_id", filters.clientId);
    const { data, error } = await q;
    if (error) throw new Error(`listLeads: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getLead(id: string): Promise<Lead | null> {
    const { data, error } = await this.db.from("leads").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveLead(lead: Lead): Promise<void> {
    const { error } = await this.db.from("leads").upsert(toRow(lead), { onConflict: "id" });
    if (error) throw new Error(`saveLead: ${error.message}`);
  }

  async deleteLead(id: string): Promise<void> {
    const { error } = await this.db.from("leads").delete().eq("id", id);
    if (error) throw new Error(`deleteLead: ${error.message}`);
  }

  async updateStage(id: string, stage: LeadStage, _actorName: string): Promise<void> {
    const { error } = await this.db.from("leads").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(`updateStage: ${error.message}`);
  }

  async getSummary(_month?: string): Promise<LeadSummary> {
    const { data, error } = await this.db.from("leads").select("stage, estimated_value, currency");
    if (error) throw new Error(`getSummary: ${error.message}`);
    const rows = (data ?? []) as Array<{ stage: LeadStage; estimated_value: number; currency: string }>;
    const byStage = {} as Record<LeadStage, number>;
    const stages: LeadStage[] = ["new","contacted","qualified","proposal_sent","negotiation","won","lost","on_hold"];
    for (const s of stages) byStage[s] = 0;
    let totalPipelineValue = 0;
    for (const r of rows) {
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
      if (!["won","lost"].includes(r.stage)) totalPipelineValue += r.estimated_value ?? 0;
    }
    return { total: rows.length, byStage, totalPipelineValue, currency: "JPY", wonThisMonth: byStage.won, lostThisMonth: byStage.lost };
  }
}
