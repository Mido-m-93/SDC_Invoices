import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import { downloadSharePointFile } from "./SharePointContractService";
import type { IExpenseService } from "../types";
import type {
  ExpenseClaim,
  ExpenseStatus,
  ExpenseValidationResult,
} from "@/types";

const EXPENSE_EXTRACT_PROMPT = `You are a receipt data extractor. Read the receipt/invoice text below carefully and extract the following fields.

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

interface ParsedReceiptFields {
  amount: number | null;
  date: string | null;
  vendor: string | null;
  purpose: string | null;
}

function parseReceiptExtractionJson(content: string): ParsedReceiptFields {
  const cleaned = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return { amount: null, date: null, vendor: null, purpose: null };
  const result = JSON.parse(m[0]) as { amount?: number | string; date?: string; vendor?: string; purpose?: string };
  const rawAmt = result.amount;
  let amount: number | null = null;
  if (typeof rawAmt === "number") {
    amount = rawAmt;
  } else if (typeof rawAmt === "string") {
    const n = parseFloat(rawAmt.replace(/[¥,￥\s]/g, ""));
    amount = isNaN(n) ? null : n;
  }
  return { amount, date: result.date ?? null, vendor: result.vendor ?? null, purpose: result.purpose ?? null };
}

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
    expense_reason: c.expenseReason,
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
    mf_billing_id: c.mfBillingId ?? null,
    mf_billing_url: c.mfBillingUrl ?? null,
    mf_sent_at: c.mfSentAt ?? null,
    mf_payee_id: c.mfPayeeId ?? null,
    mf_counterparty_id: c.mfCounterpartyId ?? null,
    mf_payee_created_at: c.mfPayeeCreatedAt ?? null,
    deleted_at: c.deletedAt ?? null,
    deleted_by: c.deletedBy ?? null,
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
    expenseReason: (row.expense_reason as string) ?? "",
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
    mfBillingId: (row.mf_billing_id as string) || undefined,
    mfBillingUrl: (row.mf_billing_url as string) || undefined,
    mfSentAt: (row.mf_sent_at as string) || undefined,
    mfPayeeId: (row.mf_payee_id as string) || undefined,
    mfCounterpartyId: (row.mf_counterparty_id as string) || undefined,
    mfPayeeCreatedAt: (row.mf_payee_created_at as string) || undefined,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    deletedBy: (row.deleted_by as string | null) ?? undefined,
  };
}

// Public transport (trains, buses, etc.) does not issue receipts in Japan —
// the RC経費精算 form explicitly tells submitters not to attach one in that case.
const TRANSPORT_NO_RECEIPT = /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i;

function normalizeDate(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

// Free-text purpose comparison: the submitter's description and the AI's
// paraphrase of the receipt rarely match verbatim, so this checks for
// meaningful word overlap rather than exact equality.
function purposeOverlaps(submitted: string, extracted: string): boolean {
  const words = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((w) => w.length > 2)
    );
  const a = words(submitted);
  const b = words(extracted);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.3;
}

// Transportation Fee Reason (description) only makes sense for transport
// expenses; every other category states its purpose in Expense Reason.
function submittedPurpose(claim: ExpenseClaim): string {
  return claim.category === "transport" ? claim.description ?? "" : claim.expenseReason ?? "";
}

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
    let query = this.db.from("expense_claims").select("*").is("deleted_at", null).order("submitted_at", { ascending: false });
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

  // Soft delete — sets deleted_at/deleted_by instead of removing the row, so
  // it can be restored from the Archives page instead of being lost.
  async deleteClaim(id: string, deletedBy?: string): Promise<void> {
    const { error } = await this.db
      .from("expense_claims")
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy ?? null })
      .eq("id", id);
    if (error) throw new Error(`deleteClaim: ${error.message}`);
  }

  async restoreClaim(id: string): Promise<void> {
    const { error } = await this.db
      .from("expense_claims")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    if (error) throw new Error(`restoreClaim: ${error.message}`);
  }

  async listDeletedClaims(): Promise<ExpenseClaim[]> {
    const { data, error } = await this.db
      .from("expense_claims")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(`listDeletedClaims: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  // Bulk hard-delete — kept as a genuine hard delete (used by test/reset
  // tooling, not the reviewer-facing Delete button), not part of the
  // soft-delete/Archives flow.
  async deleteAllClaims(): Promise<void> {
    const { error } = await this.db.from("expense_claims").delete().neq("id", "");
    if (error) throw new Error(`deleteAllClaims: ${error.message}`);
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

      // Phase 2: PDF receipts — extract text locally, then parse with Groq's
      // text model. Image receipts (.jpg/.png/...) have no embedded text to
      // extract, so they go through Groq's vision model instead, below —
      // same split as contract extraction elsewhere in this codebase.
      if (fileBuffer && mimeType === "application/pdf") {
        try {
          const { getDocumentProxy, extractText } = await import("unpdf");
          const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
          const { text: rawText } = await extractText(pdf, { mergePages: true });

          if (rawText.trim()) {
            if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
            const Groq = (await import("groq-sdk")).default;
            const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
            const response = await client.chat.completions.create({
              model: "openai/gpt-oss-120b",
              max_tokens: 512,
              messages: [{ role: "user", content: `${EXPENSE_EXTRACT_PROMPT}\n\nRECEIPT TEXT:\n${rawText.slice(0, 8000)}` }],
            });

            const parsed = parseReceiptExtractionJson(response.choices[0]?.message?.content ?? "");
            extractedAmount  = parsed.amount;
            extractedDate    = parsed.date;
            extractedVendor  = parsed.vendor;
            extractedPurpose = parsed.purpose;
            if (extractedAmount !== null) {
              amountMatchesReceipt = Math.abs(extractedAmount - claim.amount) <= 1;
            }
          }
        } catch (err) {
          console.error("[validateClaim] extraction failed:", err);
          receiptFetchError = `Extraction failed: ${String(err).slice(0, 200)}`;
        }
      } else if (fileBuffer) {
        // Photographed/scanned receipt image — read directly via Groq's
        // vision model (same model used for scanned contract images).
        // Flagged nowhere as needing review here since amount/date mismatch
        // detection below already surfaces a low-confidence read to the
        // reviewer the same way a text-extraction failure would.
        try {
          if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
          const Groq = (await import("groq-sdk")).default;
          const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const base64 = fileBuffer.toString("base64");
          const response = await client.chat.completions.create({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            max_tokens: 512,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: EXPENSE_EXTRACT_PROMPT },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              ],
            }],
          });

          const parsed = parseReceiptExtractionJson(response.choices[0]?.message?.content ?? "");
          extractedAmount  = parsed.amount;
          extractedDate    = parsed.date;
          extractedVendor  = parsed.vendor;
          extractedPurpose = parsed.purpose;
          if (extractedAmount !== null) {
            amountMatchesReceipt = Math.abs(extractedAmount - claim.amount) <= 1;
          }
        } catch (err) {
          console.error("[validateClaim] vision extraction failed:", err);
          receiptFetchError = `Extraction failed: ${String(err).slice(0, 200)}`;
        }
      }
    }

    const riskLevel = violations.includes("MISSING_RECEIPT") || violations.includes("MISSING_PURPOSE")
      ? "BLOCKED"
      : violations.length > 0
      ? "NEEDS_REVIEW"
      : "OK";

    const dateMatchesReceipt =
      extractedDate !== null && normalizeDate(extractedDate) === normalizeDate(claim.expenseDate);
    const purposeMatchesReceipt =
      extractedPurpose !== null && purposeOverlaps(submittedPurpose(claim), extractedPurpose);

    return {
      claimId: claim.id,
      receiptAccessible,
      amountMatchesReceipt,
      dateMatchesReceipt,
      purposeMatchesReceipt,
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
      contractFileUrl:    null,
      receiptFetchError:  receiptFetchError ?? undefined,
    };
  }
}
