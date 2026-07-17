import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import { generateId } from "@/lib/utils";
import type { IExpenseService } from "../types";
import type {
  ExpenseClaim,
  ExpenseStatus,
  ExpenseValidationResult,
} from "@/types";
import { extractReceiptFields, validateExpenseData } from "@/lib/services/ai/receiptExtractor";

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
    extracted_recipient: c.extractedRecipient ?? null,
    extracted_purpose: c.extractedPurpose ?? null,
    policy_violations: c.policyViolations,
    bank_account: c.bankAccount,
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
    extractedRecipient: (row.extracted_recipient as string | null) ?? null,
    extractedPurpose: (row.extracted_purpose as string | null) ?? null,
    policyViolations: (row.policy_violations as string[]) ?? [],
    bankAccount: (row.bank_account as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Public transport (trains, buses, etc.) does not issue receipts in Japan —
// the RC経費精算 form explicitly tells submitters not to attach one in that case.
const TRANSPORT_NO_RECEIPT = /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i;

function checkPolicyViolations(claim: ExpenseClaim): string[] {
  const violations: string[] = [];

  const isNoReceiptTransport =
    claim.category === "transport" && TRANSPORT_NO_RECEIPT.test(claim.description ?? "");

  if (!claim.receiptUrl && !isNoReceiptTransport) violations.push("MISSING_RECEIPT");
  // MISSING_PURPOSE is decided in validateClaim() below, once the receipt has
  // been read — a purpose written on the receipt (但し書き) can satisfy it
  // even when the submitter left the form's description field blank.
  // Project/department not collected by the RC経費精算 form — skip this check.
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

    let extractedAmount:    number | null = null;
    let extractedDate:      string | null = null;
    let extractedVendor:    string | null = null;
    let extractedRecipient: string | null = null;
    let extractedPurpose:   string | null = null;
    let purposeSatisfied = !!claim.description;
    let receiptFound = false;

    if (claim.receiptUrl) {
      // GPT-4o reads the receipt directly from the URL.
      // Images  → URL passed to GPT vision, no bytes in our code.
      // PDFs    → bytes fetched in memory, sent as base64. Nothing saved to disk.
      // SharePoint URLs → authenticated with Graph API Bearer token automatically.
      try {
        const extracted = await extractReceiptFields(claim.receiptUrl);
        receiptFound       = true;
        extractedAmount    = extracted.amount;
        extractedDate      = extracted.date;
        extractedVendor    = extracted.vendor;
        extractedRecipient = extracted.recipient;
        extractedPurpose   = extracted.purpose;
        if (extractedPurpose) purposeSatisfied = true;

        if (extractedAmount !== null && Math.abs(extractedAmount - claim.amount) > 1) {
          violations.push("AMOUNT_MISMATCH");
        }
        if (extractedDate && claim.expenseDate) {
          const diffMs = Math.abs(new Date(extractedDate).getTime() - new Date(claim.expenseDate).getTime());
          if (diffMs > 86400000) violations.push("DATE_MISMATCH");
        }
        // Receipt recipient (宛名) is often the company, not the submitter —
        // shown for reference in the UI but not checked against submittedBy.
      } catch (err) {
        console.warn("[validateClaim] receipt extraction failed:", err);
        // Fall through to text validation below
      }
    }

    if (!receiptFound) {
      // No receipt URL or extraction failed — GPT-4o validates submitted text data
      const gpt = await validateExpenseData({
        submittedBy:   claim.submittedBy,
        amount:        claim.amount,
        currency:      claim.currency,
        expenseDate:   claim.expenseDate,
        category:      claim.category,
        description:   claim.description ?? "",
        paymentMethod: claim.paymentMethod,
        hasReceipt:    !!(claim.receiptUrl || claim.receiptFilename),
      });
      for (const v of gpt.violations) {
        if (!violations.includes(v)) violations.push(v);
      }
      extractedPurpose = gpt.summary;
    }

    if (!purposeSatisfied) violations.push("MISSING_PURPOSE");

    const riskLevel = violations.includes("MISSING_RECEIPT") || violations.includes("MISSING_PURPOSE")
      ? "BLOCKED"
      : violations.length > 0
      ? "NEEDS_REVIEW"
      : "OK";

    return {
      claimId:              claim.id,
      receiptAccessible:    receiptFound,
      amountMatchesReceipt: !violations.includes("AMOUNT_MISMATCH"),
      dateFound:            !!extractedDate,
      categoryValid:        !violations.includes("CATEGORY_MISMATCH"),
      receiptMissing:       !receiptFound,
      policyViolations:     violations,
      riskLevel,
      statusCode:           violations.length > 0 ? "under_review" : "submitted",
      extractedAmount,
      extractedDate,
      extractedVendor,
      extractedRecipient,
      extractedPurpose,
    };
  }
}
