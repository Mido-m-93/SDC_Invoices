import "server-only";
import Groq from "groq-sdk";
import type { InvoiceSubmission, Member, RiskLevel } from "@/types";
import { extractFromPdf } from "./pdfExtractor";
import {
  listContractFiles,
  downloadContractById,
  downloadSharePointFile,
  type ContractFile,
} from "@/lib/services/real/SharePointContractService";

export interface AIMatchResult {
  vendorId: string | null;
  contractId: string | null;
  confidence: number;
  riskLevel: RiskLevel;
  reviewerRecommendation: string;
  reviewerRecommendationDept: string;
  reasoning: string;
}

let _client: Groq | undefined;
function getClient(): Groq {
  if (!_client) _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _client;
}

// ── Step 1: Extract contractor name + amount from the submitted invoice PDF ───

async function extractInvoiceData(
  attachmentUrl: string
): Promise<{ nameOnDoc: string | null; total: number | null }> {
  try {
    const bytes = await downloadSharePointFile(attachmentUrl);
    const fields = await extractFromPdf(bytes);
    return { nameOnDoc: fields.memberName, total: fields.total };
  } catch (err) {
    console.warn("[matchingService] Invoice PDF extraction failed:", err);
    return { nameOnDoc: null, total: null };
  }
}

// ── Step 2: Find the member's contract in SharePoint and extract the amount ──

async function findAndExtractContract(
  memberName: string,
  contracts: ContractFile[]
): Promise<{ fileName: string; contractedAmount: number | null } | null> {
  if (contracts.length === 0) return null;

  // Use Groq to pick the best-matching contract filename for this member name.
  const fileList = contracts.map((c) => `- ${c.name} (id: ${c.id})`).join("\n");
  const pick = await getClient().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 128,
    messages: [
      {
        role: "user",
        content: `Which contract file best matches the member named "${memberName}"?
Return ONLY the file id (e.g. "ABC123") or "none" if no reasonable match.

Files:
${fileList}`,
      },
    ],
  });

  const pickedId = (pick.choices[0]?.message?.content?.trim() ?? "none")
    .replace(/[^A-Za-z0-9_-]/g, "");

  const matched = contracts.find((c) => c.id === pickedId);
  if (!matched) return null;

  // Download and extract the contracted payment amount from the contract PDF.
  try {
    const bytes = await downloadContractById(matched.siteId, matched.id);
    const fields = await extractFromPdf(bytes);
    return { fileName: matched.name, contractedAmount: fields.total };
  } catch (err) {
    console.warn("[matchingService] Contract extraction failed:", err);
    return { fileName: matched.name, contractedAmount: null };
  }
}

// ── Main matching function ────────────────────────────────────────────────────

export async function matchSubmissionToMember(
  submission: InvoiceSubmission,
  members: Member[]
): Promise<AIMatchResult> {
  const activeMembers = members.filter((m) => m.status === "active");

  // Step 1 — extract contractor identity from the invoice PDF (best-effort)
  let invoiceNameOnDoc: string | null = null;
  let invoiceTotal: number | null = null;
  if (submission.invoiceAttachment) {
    const extracted = await extractInvoiceData(submission.invoiceAttachment);
    invoiceNameOnDoc = extracted.nameOnDoc;
    invoiceTotal     = extracted.total;
    console.log("[matchingService] invoice PDF →", { invoiceNameOnDoc, invoiceTotal });
  }

  // Step 2 — look up the member contract in SharePoint (best-effort)
  let contractInfo: { fileName: string; contractedAmount: number | null } | null = null;
  const nameForContractLookup = invoiceNameOnDoc ?? submission.payerName;
  try {
    const contracts = await listContractFiles();
    contractInfo = await findAndExtractContract(nameForContractLookup, contracts);
    console.log("[matchingService] contract match →", contractInfo);
  } catch (err) {
    console.warn("[matchingService] Contract lookup failed:", err);
  }

  // Step 3 — final AI match: name + email + PDF evidence + contract
  const memberList = members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    department: m.department,
    role: m.role,
    status: m.status,
  }));

  const amountNote = invoiceTotal !== null && contractInfo?.contractedAmount !== null
    ? `Invoice total: ${invoiceTotal}. Contracted amount: ${contractInfo?.contractedAmount}. ${
        Math.abs((invoiceTotal ?? 0) - (contractInfo?.contractedAmount ?? 0)) < 1
          ? "Amounts match."
          : "AMOUNTS DO NOT MATCH — flag for review."
      }`
    : invoiceTotal !== null
    ? `Invoice total extracted from PDF: ${invoiceTotal}. No contract amount found for comparison.`
    : "No amount data available.";

  const systemPrompt = `You are a member matching assistant for an invoice processing system.
Identify whether the submitter is a registered active member of the organisation.
Consider name similarity (Japanese/English variants), email match, and PDF evidence.
Respond only with valid JSON matching the exact schema requested.`;

  const userPrompt = `Match this invoice submission to a registered member.

FORM DATA:
- Payer Name (from form): ${submission.payerName}
- Email (from form): ${submission.email || "not provided"}

PDF EVIDENCE:
- Name on invoice PDF: ${invoiceNameOnDoc ?? "not extracted"}
- Contract file matched: ${contractInfo?.fileName ?? "none"}
- ${amountNote}

REGISTERED MEMBERS (${members.length} total, ${activeMembers.length} active):
${JSON.stringify(memberList, null, 2)}

Instructions:
- Use the PDF name as the primary identifier; fall back to form payer name
- vendorId = matched member id, or null if no match
- contractId = same as vendorId when member status is "active", else null
- riskLevel:
    "OK"           — member found, active, and amounts match (or no contract to compare)
    "NEEDS_REVIEW" — member found but amounts mismatch, or match is uncertain
    "BLOCKED"      — member found but inactive
    "NEEDS_REVIEW" — no member match found
- reviewerRecommendation = member's department, or "Accounting Lead"
- confidence: 1.0 exact, 0.5 fuzzy, 0.0 no match

Respond with ONLY this JSON (no markdown):
{
  "vendorId": "<id or null>",
  "contractId": "<id or null>",
  "confidence": <0.0–1.0>,
  "riskLevel": "<OK | NEEDS_REVIEW | BLOCKED>",
  "reviewerRecommendation": "<department or Accounting Lead>",
  "reasoning": "<brief explanation>"
}`;

  const response = await getClient().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 512,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "{}";

  try {
    const parsed = JSON.parse(text) as AIMatchResult;
    return {
      vendorId:                    parsed.vendorId ?? null,
      contractId:                  parsed.contractId ?? null,
      confidence:                  typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
      riskLevel:                   (["OK", "NEEDS_REVIEW", "BLOCKED"] as RiskLevel[]).includes(parsed.riskLevel)
        ? parsed.riskLevel : "NEEDS_REVIEW",
      reviewerRecommendation:      parsed.reviewerRecommendation || "Accounting Lead",
      reviewerRecommendationDept:  parsed.reviewerRecommendation || "Accounting Lead",
      reasoning:                   parsed.reasoning || "No reasoning provided",
    };
  } catch {
    return {
      vendorId:                   null,
      contractId:                 null,
      confidence:                 0,
      riskLevel:                  "NEEDS_REVIEW",
      reviewerRecommendation:     "Accounting Lead",
      reviewerRecommendationDept: "Accounting Lead",
      reasoning:                  "AI matching failed — manual review required",
    };
  }
}
