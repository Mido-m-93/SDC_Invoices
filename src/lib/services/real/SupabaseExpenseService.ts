import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IExpenseService } from "../types";
import type { ExpenseClaim } from "@/types";

function toRow(c: ExpenseClaim): Record<string, unknown> {
  return {
    id: c.id,
    submitted_by: c.submittedBy,
    submitted_by_email: c.submittedByEmail,
    submitted_at: c.submittedAt,
    category: c.category,
    purpose: c.purpose,
    amount: c.amount,
    currency: c.currency,
    receipt_attachment: c.receiptAttachment ?? null,
    receipt_filename: c.receiptFilename ?? null,
    project_name: c.projectName ?? null,
    notes: c.notes ?? null,
    status: c.status,
    receipt_accessible: c.receiptAccessible ?? null,
    extracted_amount: c.extractedAmount ?? null,
    extracted_date: c.extractedDate ?? null,
    extracted_vendor: c.extractedVendor ?? null,
    issues: c.issues ?? [],
    reviewed_by: c.reviewedBy ?? null,
    reviewed_at: c.reviewedAt ?? null,
    reviewer_comment: c.reviewerComment ?? null,
    mf_evidence_id: c.mfEvidenceId ?? null,
    created_at: c.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): ExpenseClaim {
  return {
    id: row.id as string,
    submittedBy: row.submitted_by as string,
    submittedByEmail: row.submitted_by_email as string,
    submittedAt: row.submitted_at as string,
    category: row.category as ExpenseClaim["category"],
    purpose: row.purpose as string,
    amount: row.amount as number,
    currency: row.currency as string,
    receiptAttachment: (row.receipt_attachment as string) || undefined,
    receiptFilename: (row.receipt_filename as string) || undefined,
    projectName: (row.project_name as string) || undefined,
    notes: (row.notes as string) || undefined,
    status: row.status as ExpenseClaim["status"],
    receiptAccessible: (row.receipt_accessible as boolean) ?? undefined,
    extractedAmount: (row.extracted_amount as number) ?? undefined,
    extractedDate: (row.extracted_date as string) || undefined,
    extractedVendor: (row.extracted_vendor as string) || undefined,
    issues: (row.issues as string[]) ?? [],
    reviewedBy: (row.reviewed_by as string) || undefined,
    reviewedAt: (row.reviewed_at as string) || undefined,
    reviewerComment: (row.reviewer_comment as string) || undefined,
    mfEvidenceId: (row.mf_evidence_id as string) || undefined,
    createdAt: row.created_at as string,
  };
}

export class SupabaseExpenseService implements IExpenseService {
  private get db() { return getSupabaseClient(); }

  async listExpenses(filters?: { status?: string; month?: string }): Promise<ExpenseClaim[]> {
    let query = this.db.from("expense_claims").select("*").order("submitted_at", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.month)  query = query.gte("submitted_at", `${filters.month}-01`).lt("submitted_at", nextMonth(filters.month));
    const { data, error } = await query;
    if (error) throw new Error(`listExpenses: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getExpense(id: string): Promise<ExpenseClaim | null> {
    const { data, error } = await this.db.from("expense_claims").select("*").eq("id", id).single();
    if (error || !data) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveExpense(claim: ExpenseClaim): Promise<void> {
    const { error } = await this.db.from("expense_claims").upsert(toRow(claim), { onConflict: "id" });
    if (error) throw new Error(`saveExpense: ${error.message}`);
  }

  async deleteExpense(id: string): Promise<void> {
    const { error } = await this.db.from("expense_claims").delete().eq("id", id);
    if (error) throw new Error(`deleteExpense: ${error.message}`);
  }
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
