import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IAccountingService } from "../types";
import type { AccountingEntry, AccountingEntryType, AccountingEntryStatus, ProfitAndLoss, AccountingSummary } from "@/types";

function toRow(e: AccountingEntry): Record<string, unknown> {
  return { id: e.id, entry_date: e.entryDate, month: e.month, type: e.type, category: e.category, description: e.description, amount: e.amount, currency: e.currency, exchange_rate: e.exchangeRate, amount_jpy: e.amountJpy, status: e.status, source_type: e.sourceType, source_id: e.sourceId, client_id: e.clientId, vendor_id: e.vendorId, member_id: e.memberId, notes: e.notes, posted_by: e.postedBy, posted_at: e.postedAt ?? null, created_at: e.createdAt, updated_at: e.updatedAt };
}

function fromRow(r: Record<string, unknown>): AccountingEntry {
  return { id: r.id as string, entryDate: r.entry_date as string, month: r.month as string, type: r.type as AccountingEntryType, category: r.category as string, description: r.description as string, amount: r.amount as number, currency: r.currency as string, exchangeRate: r.exchange_rate as number, amountJpy: r.amount_jpy as number, status: r.status as AccountingEntryStatus, sourceType: r.source_type as string, sourceId: r.source_id as string, clientId: r.client_id as string, vendorId: r.vendor_id as string, memberId: r.member_id as string, notes: r.notes as string, postedBy: r.posted_by as string, postedAt: r.posted_at as string | null, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

export class SupabaseAccountingService implements IAccountingService {
  private get db() { return getSupabaseClient(); }

  async listEntries(filters?: { month?: string; type?: AccountingEntryType; status?: AccountingEntryStatus; sourceType?: string }): Promise<AccountingEntry[]> {
    let q = this.db.from("accounting_entries").select("*").order("entry_date", { ascending: false });
    if (filters?.month) q = q.eq("month", filters.month);
    if (filters?.type) q = q.eq("type", filters.type);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.sourceType) q = q.eq("source_type", filters.sourceType);
    const { data, error } = await q;
    if (error) throw new Error(`listEntries: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getEntry(id: string): Promise<AccountingEntry | null> {
    const { data, error } = await this.db.from("accounting_entries").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveEntry(entry: AccountingEntry): Promise<void> {
    const { error } = await this.db.from("accounting_entries").upsert(toRow(entry), { onConflict: "id" });
    if (error) throw new Error(`saveEntry: ${error.message}`);
  }

  async deleteEntry(id: string): Promise<void> {
    const { error } = await this.db.from("accounting_entries").delete().eq("id", id);
    if (error) throw new Error(`deleteEntry: ${error.message}`);
  }

  async postEntry(id: string, actorName: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db.from("accounting_entries").update({ status: "posted", posted_by: actorName, posted_at: now, updated_at: now }).eq("id", id);
    if (error) throw new Error(`postEntry: ${error.message}`);
  }

  async voidEntry(id: string, actorName: string): Promise<void> {
    const { error } = await this.db.from("accounting_entries").update({ status: "voided", posted_by: actorName, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(`voidEntry: ${error.message}`);
  }

  async getProfitAndLoss(month: string): Promise<ProfitAndLoss> {
    const { data, error } = await this.db.from("accounting_entries").select("type, category, amount_jpy").eq("month", month).eq("status", "posted");
    if (error) throw new Error(`getProfitAndLoss: ${error.message}`);
    const rows = (data ?? []) as Array<{ type: AccountingEntryType; category: string; amount_jpy: number }>;
    const catMap = new Map<string, { category: string; type: AccountingEntryType; total: number }>();
    let totalRevenue = 0, totalExpenses = 0;
    for (const r of rows) {
      const key = `${r.type}:${r.category}`;
      const existing = catMap.get(key);
      if (existing) existing.total += r.amount_jpy;
      else catMap.set(key, { category: r.category, type: r.type, total: r.amount_jpy });
      if (r.type === "revenue") totalRevenue += r.amount_jpy;
      else if (r.type === "expense") totalExpenses += r.amount_jpy;
    }
    const grossProfit = totalRevenue - totalExpenses;
    return { month, totalRevenue, totalExpenses, grossProfit, grossMarginPct: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0, byCategory: Array.from(catMap.values()), currency: "JPY" };
  }

  async getSummary(month: string): Promise<AccountingSummary> {
    const entries = await this.listEntries({ month });
    const posted = entries.filter(e => e.status === "posted");
    const revenue = posted.filter(e => e.type === "revenue").reduce((s, e) => s + e.amountJpy, 0);
    const expenses = posted.filter(e => e.type === "expense").reduce((s, e) => s + e.amountJpy, 0);
    return { month, revenue, expenses, profit: revenue - expenses, entryCount: entries.length, draftCount: entries.filter(e => e.status === "draft").length, currency: "JPY" };
  }
}
