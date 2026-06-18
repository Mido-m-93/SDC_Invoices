import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "@/lib/supabase";
import { generateId } from "@/lib/utils";
import type { IExpenseService } from "../types";
import type {
  ExpenseClaim,
  ExpenseStatus,
  ExpenseValidationResult,
} from "@/types";

const EXPENSE_EXTRACT_PROMPT = `Extract fields from this receipt/invoice image or PDF.
Return ONLY valid JSON:
{
  "amount": number or null,
  "date": "YYYY-MM-DD or null",
  "vendor": "vendor name or null",
  "currency": "JPY or USD or null"
}`;

function toRow(c: ExpenseClaim): Record<string, unknown> {
  return {
    id: c.id,
    submitted_by: c.submittedBy,
    submitted_by_email: c.submittedByEmail,
    submitted_at: c.submittedAt,
    category: c.category,
    description: c.description,
    amount: c.amount,
    currency: c.currency,
    payment_method: c.paymentMethod,
    receipt_url: c.receiptUrl,
    receipt_filename: c.receiptFilename,
    project_name: c.projectName,
    internal_department: c.internalDepartment,
    expense_date: c.expenseDate,
    status: c.status,
    reviewer_comment: c.reviewerComment,
    reviewed_by: c.reviewedBy,
    reviewed_at: c.reviewedAt,
    approved_by: c.approvedBy,
    approved_at: c.approvedAt,
    paid_at: c.paidAt,
    extracted_amount: c.extractedAmount,
    extracted_date: c.extractedDate,
    extracted_vendor: c.extractedVendor,
    policy_violations: c.policyViolations,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): ExpenseClaim {
  return {
    id: row.id as string,
    submittedBy: row.submitted_by as string,
    submittedByEmail: row.submitted_by_email as string,
    submittedAt: row.submitted_at as string,
    category: row.category as ExpenseClaim["category"],
    description: row.description as string,
    amount: row.amount as number,
    currency: (row.currency as string) ?? "JPY",
    paymentMethod: row.payment_method as ExpenseClaim["paymentMethod"],
    receiptUrl: (row.receipt_url as string) ?? "",
    receiptFilename: (row.receipt_filename as string) ?? "",
    projectName: (row.project_name as string) ?? "",
    internalDepartment: (row.internal_department as string) ?? "",
    expenseDate: (row.expense_date as string) ?? "",
    status: row.status as ExpenseStatus,
    reviewerComment: (row.reviewer_comment as string) ?? "",
    reviewedBy: (row.reviewed_by as string) ?? "",
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    approvedBy: (row.approved_by as string) ?? "",
    approvedAt: (row.approved_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    extractedAmount: (row.extracted_amount as number | null) ?? null,
    extractedDate: (row.extracted_date as string | null) ?? null,
    extractedVendor: (row.extracted_vendor as string | null) ?? null,
    policyViolations: (row.policy_violations as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function checkPolicyViolations(claim: ExpenseClaim): string[] {
  const violations: string[] = [];
  if (!claim.receiptUrl) violations.push("MISSING_RECEIPT");
  if (!claim.description) violations.push("MISSING_PURPOSE");
  if (!claim.projectName && !claim.internalDepartment) violations.push("MISSING_PROJECT");
  if (claim.amount > 100000 && claim.paymentMethod === "personal_reimbursement") {
    violations.push("HIGH_AMOUNT_PERSONAL_REIMBURSEMENT");
  }
  if (claim.amount > 1000000) violations.push("REQUIRES_MANAGEMENT_APPROVAL");
  return violations;
}

export class SupabaseExpenseService implements IExpenseService {
  private get db() {
    return getSupabaseClient();
  }

  async listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]> {
    let query = this.db.from("expense_claims").select("*").order("submitted_at", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.submittedBy) query = query.eq("submitted_by", filters.submittedBy);
    const { data, error } = await query;
    if (error) throw new Error(`listClaims: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getClaim(id: string): Promise<ExpenseClaim | null> {
    const { data, error } = await this.db.from("expense_claims").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveClaim(claim: ExpenseClaim): Promise<void> {
    const { error } = await this.db
      .from("expense_claims")
      .upsert(toRow(claim), { onConflict: "id" });
    if (error) throw new Error(`saveClaim: ${error.message}`);
  }

  async deleteClaim(id: string): Promise<void> {
    const { error } = await this.db.from("expense_claims").delete().eq("id", id);
    if (error) throw new Error(`deleteClaim: ${error.message}`);
  }

  async updateStatus(id: string, status: ExpenseStatus, actorName: string, comment?: string): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === "under_review" || status === "rejected") {
      updates.reviewed_by = actorName;
      updates.reviewed_at = new Date().toISOString();
      if (comment) updates.reviewer_comment = comment;
    }
    if (status === "approved") {
      updates.approved_by = actorName;
      updates.approved_at = new Date().toISOString();
    }
    if (status === "paid") {
      updates.paid_at = new Date().toISOString();
    }
    const { error } = await this.db.from("expense_claims").update(updates).eq("id", id);
    if (error) throw new Error(`updateStatus: ${error.message}`);
  }

  async validateClaim(claim: ExpenseClaim): Promise<ExpenseValidationResult> {
    const violations = checkPolicyViolations(claim);
    let extractedAmount: number | null = null;
    let extractedDate: string | null = null;
    let extractedVendor: string | null = null;
    let receiptAccessible = false;
    let amountMatchesReceipt = false;

    if (claim.receiptUrl) {
      try {
        const res = await fetch(claim.receiptUrl);
        receiptAccessible = res.ok;
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          const isPdf = claim.receiptFilename.toLowerCase().endsWith(".pdf");
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = [
            { type: "document", source: { type: "base64", media_type: isPdf ? "application/pdf" : "image/jpeg", data: b64 } },
            { type: "text", text: EXPENSE_EXTRACT_PROMPT },
          ];
          const msg = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 512,
            messages: [{ role: "user", content }],
          });
          const text = (msg.content[0] as { type: string; text?: string }).text ?? "";
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]) as { amount?: number; date?: string; vendor?: string };
            extractedAmount = typeof parsed.amount === "number" ? parsed.amount : null;
            extractedDate = parsed.date ?? null;
            extractedVendor = parsed.vendor ?? null;
            if (extractedAmount !== null) {
              amountMatchesReceipt = Math.abs(extractedAmount - claim.amount) <= 1;
            }
          }
        }
      } catch {
        receiptAccessible = false;
      }
    }

    const riskLevel = violations.includes("MISSING_RECEIPT") || violations.includes("MISSING_PURPOSE")
      ? "BLOCKED"
      : violations.length > 0
      ? "NEEDS_REVIEW"
      : "OK";

    return {
      claimId: claim.id,
      receiptAccessible,
      amountMatchesReceipt,
      dateFound: extractedDate !== null,
      categoryValid: true,
      receiptMissing: !claim.receiptUrl,
      policyViolations: violations,
      riskLevel,
      statusCode: violations.length > 0 ? "under_review" : "submitted",
      extractedAmount,
      extractedDate,
      extractedVendor,
    };
  }
}
