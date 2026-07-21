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
Return ONLY valid JSON with no extra text:
{
  "amount": number or null,
  "date": "YYYY-MM-DD" or null,
  "vendor": "store or service name" or null,
  "currency": "JPY" or "USD" or null,
  "purpose": "one-line description of what the expense was for" or null
}
For Japanese receipts: 合計 or 税込 is the total amount. 日付 or 年月日 is the date.`;

async function getGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     process.env.AZURE_CLIENT_ID!,
        client_secret: process.env.AZURE_CLIENT_SECRET!,
        scope:         "https://graph.microsoft.com/.default",
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Graph token failed ${res.status}`);
  const { access_token } = await res.json() as { access_token: string };
  return access_token;
}

function sniffMime(url: string, ct: string): string {
  if (ct.startsWith("image/") || ct === "application/pdf") return ct;
  if (/\.pdf$/i.test(url))  return "application/pdf";
  if (/\.png$/i.test(url))  return "image/png";
  if (/\.gif$/i.test(url))  return "image/gif";
  if (/\.webp$/i.test(url)) return "image/webp";
  return "image/jpeg";
}

function isHtmlBuffer(buf: Buffer): boolean {
  const head = buf.slice(0, 512).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<head");
}

// Fetch a receipt file. For SharePoint URLs:
// 1. Try direct fetch with Graph bearer token.
// 2. If response is HTML (viewer page), resolve via Graph /shares API instead.
// 3. If /shares fails, walk the owner's OneDrive Microsoft Forms folder by filename.
async function fetchReceiptFile(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const isSharePoint = /sharepoint\.com|onedrive\.live\.com/i.test(url);
  const isUrl = url.startsWith("http");

  console.log(`[fetchReceiptFile] url=${url.slice(0, 120)} isSharePoint=${isSharePoint} isUrl=${isUrl}`);

  if (!isUrl) {
    // receiptUrl is a bare filename — search for it in the owner's OneDrive Forms folder
    return fetchByFilename(url);
  }

  if (isSharePoint) {
    let token: string;
    try { token = await getGraphToken(); }
    catch (e) {
      console.error("[fetchReceiptFile] getGraphToken failed:", e);
      return null;
    }

    // Attempt 1: direct fetch with auth
    const direct = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    console.log(`[fetchReceiptFile] direct status=${direct.status} ct=${direct.headers.get("content-type")}`);
    if (direct.ok) {
      const ct     = direct.headers.get("content-type")?.split(";")[0].trim() ?? "";
      const buffer = Buffer.from(await direct.arrayBuffer());
      console.log(`[fetchReceiptFile] direct ok bytes=${buffer.length} ct=${ct} isHtml=${isHtmlBuffer(buffer)}`);
      if (!ct.startsWith("text/html") && !ct.startsWith("text/xml") && !isHtmlBuffer(buffer)) {
        return { buffer, mimeType: sniffMime(url, ct) };
      }
    }

    // Attempt 2: resolve via Graph /shares — works for /:i:/ /:x:/ sharing-link URLs
    const shareId = "u!" + Buffer.from(url).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "follow", cache: "no-store" }
    );
    console.log(`[fetchReceiptFile] shares status=${graphRes.status} ct=${graphRes.headers.get("content-type")}`);
    if (graphRes.ok) {
      const ct  = graphRes.headers.get("content-type")?.split(";")[0].trim() ?? "";
      const buf = Buffer.from(await graphRes.arrayBuffer());
      console.log(`[fetchReceiptFile] shares ok bytes=${buf.length} isHtml=${isHtmlBuffer(buf)}`);
      if (!isHtmlBuffer(buf)) {
        return { buffer: buf, mimeType: sniffMime(url, ct) };
      }
    }

    // Attempt 3: extract filename from URL and search owner's OneDrive
    const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "");
    if (filename) {
      console.log(`[fetchReceiptFile] falling back to filename search: ${filename}`);
      return fetchByFilename(filename, token);
    }
    return null;
  }

  // Non-SharePoint: plain fetch
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, mimeType: sniffMime(url, ct) };
}

// Search the owner's OneDrive for a receipt file by name (fallback when URL is bare filename)
async function fetchByFilename(filename: string, token?: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const tok      = token ?? await getGraphToken();
    const ownerUpn = process.env.MICROSOFT_OWNER_UPN!;
    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ownerUpn)}/drive`,
      { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }
    );
    const { id: driveId } = await driveRes.json() as { id: string };

    const searchRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='${encodeURIComponent(filename)}')?$select=id,name,file&$top=5`,
      { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }
    );
    const { value: items } = await searchRes.json() as { value: Array<{ id: string; name: string }> };
    const match = items?.find((i) => i.name === filename || i.name.startsWith(filename.replace(/\.[^.]+$/, "")));
    if (!match) { console.log(`[fetchByFilename] no match for "${filename}"`); return null; }

    const dlRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${match.id}/content`,
      { headers: { Authorization: `Bearer ${tok}` }, redirect: "follow", cache: "no-store" }
    );
    if (!dlRes.ok) return null;
    const ct  = dlRes.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const buf = Buffer.from(await dlRes.arrayBuffer());
    console.log(`[fetchByFilename] found "${match.name}" bytes=${buf.length} ct=${ct}`);
    return { buffer: buf, mimeType: sniffMime(filename, ct) };
  } catch (e) {
    console.error("[fetchByFilename] error:", e);
    return null;
  }
}

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

    if (claim.receiptUrl) {
      try {
        const fetched = await fetchReceiptFile(claim.receiptUrl);
        receiptAccessible = fetched !== null;
        if (fetched) {
          const b64    = fetched.buffer.toString("base64");
          const isPdf  = fetched.mimeType === "application/pdf";
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = [
            isPdf
              ? { type: "document", source: { type: "base64", media_type: "application/pdf",      data: b64 } }
              : { type: "image",    source: { type: "base64", media_type: fetched.mimeType,        data: b64 } },
            { type: "text", text: EXPENSE_EXTRACT_PROMPT },
          ];
          const msg = await client.messages.create({
            model:     "claude-haiku-4-5",
            max_tokens: 512,
            messages: [{ role: "user", content }],
          });
          const text = (msg.content[0] as { type: string; text?: string }).text ?? "";
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]) as { amount?: number; date?: string; vendor?: string; purpose?: string };
            extractedAmount  = typeof parsed.amount === "number" ? parsed.amount : null;
            extractedDate    = parsed.date    ?? null;
            extractedVendor  = parsed.vendor  ?? null;
            extractedPurpose = parsed.purpose ?? null;
            if (extractedAmount !== null) {
              amountMatchesReceipt = Math.abs(extractedAmount - claim.amount) <= 1;
            }
          }
        }
      } catch (err) {
        console.error("[validateClaim] receipt fetch/extract failed:", err);
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
      extractedPurpose,
      memberMatched:    false,
      contractFileName: null,
    };
  }
}
