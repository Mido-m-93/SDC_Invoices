import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "@/lib/supabase";
import { downloadSharePointFile } from "./SharePointContractService";
import type { IExpenseService } from "../types";
import type {
  ExpenseClaim,
  ExpenseStatus,
  ExpenseValidationResult,
} from "@/types";

const EXPENSE_EXTRACT_PROMPT = `You are a receipt data extractor. Read the attached receipt or invoice carefully and extract the following fields.

Return ONLY a JSON object — no markdown, no explanation, no code fences:
{"amount":5000,"date":"2026-07-03","vendor":"ヤマダ電機","currency":"JPY","purpose":"USB cable for office laptop"}

Rules:
- amount: the final total as a plain number (no ¥ or commas). Use 合計 or 税込合計 for Japanese receipts.
- date: in YYYY-MM-DD format. Use 日付, 年月日, or any date visible on the receipt.
- vendor: store or service name (店名, 会社名).
- currency: "JPY" if ¥ symbol or Japanese text, otherwise "USD" or the correct code.
- purpose: one short English sentence describing what was purchased.
- If a field is truly not present, use null.

This receipt may be in Japanese. Read all text carefully including headers, footers, and stamps.`;

function sniffMimeFromUrl(url: string): string {
  if (/\.pdf$/i.test(url))  return "application/pdf";
  if (/\.png$/i.test(url))  return "image/png";
  if (/\.gif$/i.test(url))  return "image/gif";
  if (/\.webp$/i.test(url)) return "image/webp";
  return "image/jpeg";
}

function toRow(c: ExpenseClaim): Record<string, unknown> {
  return {
    id: c.id,
    submitted_by: c.submittedBy,
    submitted_by_email: c.submittedByEmail,
    submitted_at: c.submittedAt ? new Date(c.submittedAt).toISOString() : new Date().toISOString(),
    category: c.category,
    description: c.description,
    amount: c.amount,
    currency: c.currency,
    payment_method: c.paymentMethod,
    receipt_url: c.receiptUrl,
    receipt_filename: c.receiptFilename,
    project_name: c.projectName,
    internal_department: c.internalDepartment,
    expense_date: c.expenseDate ? new Date(c.expenseDate).toISOString().slice(0, 10) : null,
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
  if (!claim.description) violations.push("MISSING_PURPOSE");
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
    let extractedAmount: number | null = null;
    let extractedDate: string | null = null;
    let extractedVendor: string | null = null;
    let extractedPurpose: string | null = null;
    let receiptAccessible = false;
    let amountMatchesReceipt = false;
    let receiptFetchError: string | null = null;

    if (claim.receiptUrl) {
      // Phase 1: download — controls receiptAccessible
      let fileBuffer: Buffer | null = null;
      let mimeType = "application/pdf";
      try {
        const bytes = await downloadSharePointFile(claim.receiptUrl);
        fileBuffer = Buffer.from(bytes);
        receiptAccessible = true;
        const fileRef = claim.receiptFilename ?? claim.receiptUrl;
        mimeType = sniffMimeFromUrl(fileRef);
      } catch (err) {
        console.error("[validateClaim] download failed:", err);
        receiptFetchError = String(err);
      }

      // Phase 2: AI extraction — never overrides receiptAccessible
      if (fileBuffer) {
        try {
          const b64   = fileBuffer.toString("base64");
          const isPdf = mimeType === "application/pdf";
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = [
            isPdf
              ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
              : { type: "image",    source: { type: "base64", media_type: mimeType,           data: b64 } },
            { type: "text", text: EXPENSE_EXTRACT_PROMPT },
          ];
          const msg = await client.messages.create({
            model:      "claude-haiku-4-5",
            max_tokens: 512,
            messages:   [{ role: "user", content }],
          });
          const text    = (msg.content[0] as { type: string; text?: string }).text ?? "";
          const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
          const m = cleaned.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const parsed = JSON.parse(m[0]) as { amount?: number | string; date?: string; vendor?: string; purpose?: string };
              const rawAmt = parsed.amount;
              if (typeof rawAmt === "number") {
                extractedAmount = rawAmt;
              } else if (typeof rawAmt === "string") {
                const n = parseFloat(rawAmt.replace(/[¥,￥\s]/g, ""));
                extractedAmount = isNaN(n) ? null : n;
              }
              extractedDate    = parsed.date    ?? null;
              extractedVendor  = parsed.vendor  ?? null;
              extractedPurpose = parsed.purpose ?? null;
              if (extractedAmount !== null) {
                amountMatchesReceipt = Math.abs(extractedAmount - claim.amount) <= 1;
              }
            } catch {
              console.warn("[validateClaim] JSON parse failed:", text.slice(0, 200));
            }
          } else {
            console.warn("[validateClaim] no JSON in AI response:", text.slice(0, 200));
          }
        } catch (err) {
          console.error("[validateClaim] AI extraction failed:", err);
          receiptFetchError = `AI extraction failed: ${String(err)}`;
        }
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
      extractedPurpose,
      memberMatched:      false,
      contractFileName:   null,
      receiptFetchError:  receiptFetchError ?? undefined,
    };
  }
}
