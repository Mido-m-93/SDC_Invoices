import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { ICloseService } from "../types";
import type { MonthlyChecklistItem, BankSyncStatus } from "@/types";

const DEFAULT_CHECKLIST: Omit<MonthlyChecklistItem, "id" | "month" | "completedBy" | "completedAt" | "notes">[] = [
  { category: "invoices",  title: "All inbound invoices reviewed",        status: "pending", sortOrder: 1 },
  { category: "invoices",  title: "Blocked invoices resolved or escalated", status: "pending", sortOrder: 2 },
  { category: "invoices",  title: "All invoices sent to Money Forward",   status: "pending", sortOrder: 3 },
  { category: "expenses",  title: "All expense claims reviewed",          status: "pending", sortOrder: 4 },
  { category: "expenses",  title: "Missing receipts chased",              status: "pending", sortOrder: 5 },
  { category: "outbound",  title: "Outbound invoices issued to clients",  status: "pending", sortOrder: 6 },
  { category: "outbound",  title: "Unpaid outbound invoices checked",     status: "pending", sortOrder: 7 },
  { category: "bank",      title: "Money Forward bank sync verified",     status: "pending", sortOrder: 8 },
  { category: "bank",      title: "Unresolved bank sync issues cleared",  status: "pending", sortOrder: 9 },
  { category: "tax",       title: "Consumption tax items reviewed",       status: "pending", sortOrder: 10 },
  { category: "payroll",   title: "Payroll items reviewed",               status: "pending", sortOrder: 11 },
  { category: "reporting", title: "Management summary prepared",          status: "pending", sortOrder: 12 },
];

function toRow(item: MonthlyChecklistItem): Record<string, unknown> {
  return {
    id: item.id,
    month: item.month,
    category: item.category,
    title: item.title,
    description: item.description ?? null,
    status: item.status,
    completed_by: item.completedBy ?? null,
    completed_at: item.completedAt ?? null,
    notes: item.notes ?? null,
    sort_order: item.sortOrder,
  };
}

function fromRow(row: Record<string, unknown>): MonthlyChecklistItem {
  return {
    id: row.id as string,
    month: row.month as string,
    category: row.category as string,
    title: row.title as string,
    description: (row.description as string) || undefined,
    status: row.status as MonthlyChecklistItem["status"],
    completedBy: (row.completed_by as string) || undefined,
    completedAt: (row.completed_at as string) || undefined,
    notes: (row.notes as string) || undefined,
    sortOrder: row.sort_order as number,
  };
}

export class SupabaseCloseService implements ICloseService {
  private get db() { return getSupabaseClient(); }

  async getChecklist(month: string): Promise<MonthlyChecklistItem[]> {
    const { data, error } = await this.db
      .from("monthly_checklist")
      .select("*")
      .eq("month", month)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(`getChecklist: ${error.message}`);
    if (!data || data.length === 0) return this.initChecklist(month);
    return data.map((r) => fromRow(r as Record<string, unknown>));
  }

  async saveChecklistItem(item: MonthlyChecklistItem): Promise<void> {
    const { error } = await this.db.from("monthly_checklist").upsert(toRow(item), { onConflict: "id" });
    if (error) throw new Error(`saveChecklistItem: ${error.message}`);
  }

  async initChecklist(month: string): Promise<MonthlyChecklistItem[]> {
    const items: MonthlyChecklistItem[] = DEFAULT_CHECKLIST.map((d, i) => ({
      ...d,
      id: `${month}-${String(i + 1).padStart(2, "0")}`,
      month,
    }));
    for (const item of items) {
      const { error } = await this.db.from("monthly_checklist").upsert(toRow(item), { onConflict: "id" });
      if (error) console.warn(`[CloseService] initChecklist upsert failed:`, error.message);
    }
    return items;
  }

  async getBankSyncStatus(): Promise<BankSyncStatus> {
    // Try to infer from Money Forward API — if not configured, return unknown
    const accessToken = process.env.MF_ACCESS_TOKEN;
    if (!accessToken) {
      return { lastSyncAt: null, status: "unknown", message: "MF_ACCESS_TOKEN not configured", unresolvedCount: 0 };
    }
    try {
      const res = await fetch("https://invoice.moneyforward.com/api/v3/bank_account_history_items?limit=1", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (res.status === 401) {
        return { lastSyncAt: null, status: "error", message: "Money Forward token expired", unresolvedCount: 0 };
      }
      if (!res.ok) {
        return { lastSyncAt: null, status: "warning", message: `MF API returned ${res.status}`, unresolvedCount: 0 };
      }
      const data = await res.json() as { bank_account_history_items?: Array<{ created_at?: string }> };
      const lastItem = data.bank_account_history_items?.[0];
      return {
        lastSyncAt: lastItem?.created_at ?? null,
        status: "ok",
        message: "Bank sync is up to date",
        unresolvedCount: 0,
      };
    } catch (err) {
      return { lastSyncAt: null, status: "error", message: String(err), unresolvedCount: 0 };
    }
  }
}
