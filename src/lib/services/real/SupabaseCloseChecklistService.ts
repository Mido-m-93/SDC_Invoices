import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import { generateId } from "@/lib/utils";
import type { ICloseChecklistService } from "../types";
import type { CloseChecklistItem, MonthlyCloseChecklist, CloseChecklistItemStatus } from "@/types";

// Default checklist template — created fresh for each new month
const CHECKLIST_TEMPLATE: Array<Omit<CloseChecklistItem, "id" | "month" | "status" | "assignee" | "completedBy" | "completedAt" | "notes">> = [
  { category: "bank", title: "Verify bank balance", titleJa: "銀行残高確認", description: "Check that Money Forward bank sync matches latest bank statement", sortOrder: 1 },
  { category: "bank", title: "Resolve bank sync errors", titleJa: "銀行同期エラー解消", description: "Investigate and resolve any Money Forward sync failures", sortOrder: 2 },
  { category: "invoices", title: "Review all received invoices", titleJa: "受領請求書の確認", description: "Ensure all received invoices are reviewed and approved or blocked", sortOrder: 3 },
  { category: "invoices", title: "Verify unpaid invoices", titleJa: "未払い請求書の確認", description: "Check for invoices past due date and escalate", sortOrder: 4 },
  { category: "invoices", title: "Confirm outbound invoices sent", titleJa: "発行請求書の送付確認", description: "Verify all outbound invoices for the month have been sent to clients", sortOrder: 5 },
  { category: "expenses", title: "Review expense claims", titleJa: "経費申請の確認", description: "Review and approve or reject pending expense claims", sortOrder: 6 },
  { category: "expenses", title: "Verify receipt documentation", titleJa: "領収書の確認", description: "Ensure all expense claims have valid receipt attachments", sortOrder: 7 },
  { category: "vendors", title: "Check vendor payments", titleJa: "取引先支払い確認", description: "Confirm all contracted vendor payments have been processed", sortOrder: 8 },
  { category: "mf", title: "Update Money Forward records", titleJa: "Money Forward 更新", description: "Ensure all transactions are recorded correctly in Money Forward", sortOrder: 9 },
  { category: "mf", title: "Review foreign currency items", titleJa: "外貨取引の確認", description: "Review and reconcile any foreign currency transactions", sortOrder: 10 },
  { category: "tax", title: "Confirm tax / payroll items", titleJa: "税金・給与の確認", description: "Review tax and payroll related entries for the month", sortOrder: 11 },
  { category: "report", title: "Generate management summary", titleJa: "経営サマリーの作成", description: "Prepare monthly close summary report for management", sortOrder: 12 },
];

function fromRow(row: Record<string, unknown>): CloseChecklistItem {
  return {
    id: row.id as string,
    month: row.month as string,
    category: row.category as string,
    title: row.title as string,
    titleJa: (row.title_ja as string) ?? "",
    description: (row.description as string) ?? "",
    status: row.status as CloseChecklistItemStatus,
    assignee: (row.assignee as string) ?? "",
    completedBy: (row.completed_by as string) ?? "",
    completedAt: (row.completed_at as string | null) ?? null,
    notes: (row.notes as string) ?? "",
    sortOrder: (row.sort_order as number) ?? 0,
  };
}

export class SupabaseCloseChecklistService implements ICloseChecklistService {
  private get db() {
    return getSupabaseClient();
  }

  async getChecklist(month: string): Promise<MonthlyCloseChecklist> {
    const { data, error } = await this.db
      .from("monthly_close_checklists")
      .select("*")
      .eq("month", month)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(`getChecklist: ${error.message}`);

    let items = (data ?? []).map((r) => fromRow(r as Record<string, unknown>));

    // Auto-create checklist for the month if it doesn't exist
    if (items.length === 0) {
      items = await this.createDefaultChecklist(month);
    }

    const doneItems = items.filter((i) => i.status === "done" || i.status === "na").length;
    const blockedItems = items.filter((i) => i.status === "blocked").length;
    const allDone = items.length > 0 && doneItems === items.length;

    return {
      month,
      items,
      totalItems: items.length,
      doneItems,
      blockedItems,
      completedAt: allDone ? (items.at(-1)?.completedAt ?? null) : null,
    };
  }

  private async createDefaultChecklist(month: string): Promise<CloseChecklistItem[]> {
    const now = new Date().toISOString();
    const rows = CHECKLIST_TEMPLATE.map((t) => ({
      id: generateId(),
      month,
      category: t.category,
      title: t.title,
      title_ja: t.titleJa,
      description: t.description,
      status: "pending",
      assignee: "",
      completed_by: "",
      completed_at: null,
      notes: "",
      sort_order: t.sortOrder,
      created_at: now,
      updated_at: now,
    }));

    const { data, error } = await this.db
      .from("monthly_close_checklists")
      .insert(rows)
      .select("*");

    if (error) throw new Error(`createDefaultChecklist: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async updateItem(
    id: string,
    updates: Partial<Pick<CloseChecklistItem, "status" | "assignee" | "completedBy" | "completedAt" | "notes">>
  ): Promise<void> {
    const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.assignee !== undefined) dbUpdates.assignee = updates.assignee;
    if (updates.completedBy !== undefined) dbUpdates.completed_by = updates.completedBy;
    if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

    // Auto-set completedAt when marking done
    if (updates.status === "done" && !updates.completedAt) {
      dbUpdates.completed_at = new Date().toISOString();
    }
    if (updates.status && updates.status !== "done") {
      dbUpdates.completed_at = null;
    }

    const { error } = await this.db
      .from("monthly_close_checklists")
      .update(dbUpdates)
      .eq("id", id);
    if (error) throw new Error(`updateItem: ${error.message}`);
  }

  async resetChecklist(month: string): Promise<void> {
    const { error } = await this.db
      .from("monthly_close_checklists")
      .delete()
      .eq("month", month);
    if (error) throw new Error(`resetChecklist: ${error.message}`);
    // Next getChecklist call will recreate the default template
  }
}
