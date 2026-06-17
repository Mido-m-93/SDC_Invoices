import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceSubmission, Vendor, Contract, RiskLevel } from "@/types";

export interface AIMatchResult {
  vendorId: string | null;
  contractId: string | null;
  confidence: number;
  riskLevel: RiskLevel;
  reviewerRecommendation: string;
  reasoning: string;
}

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function matchSubmissionToVendorContract(
  submission: InvoiceSubmission,
  vendors: Vendor[],
  contracts: Contract[]
): Promise<AIMatchResult> {
  const today = new Date().toISOString().slice(0, 10);
  const activeVendors = vendors.filter((v) => v.status === "active");
  const activeContracts = contracts.filter(
    (c) =>
      c.status === "active" &&
      (!c.startDate || c.startDate <= today) &&
      (!c.endDate || c.endDate >= today)
  );

  const vendorList = activeVendors.map((v) => ({
    id: v.id,
    name: v.name,
    aliases: v.aliases,
    defaultReviewer: v.defaultReviewer,
    defaultProject: v.defaultProject,
  }));

  const contractList = activeContracts.map((c) => ({
    id: c.id,
    vendorId: c.vendorId,
    projectName: c.projectName,
    expectedMonthlyAmount: c.expectedMonthlyAmount,
    currency: c.currency,
  }));

  const systemPrompt = `You are a vendor and contract matching assistant for an invoice processing system.
Given an invoice submission and lists of known vendors and contracts, identify the best match.
Consider: name similarity (including Japanese/English variants and aliases), project name, and claimed amount vs expected amount.
Respond only with a valid JSON object matching the exact schema requested.`;

  const userPrompt = `Match this invoice submission to a vendor and contract.

SUBMISSION:
- Payer Name: ${submission.payerName}
- Email: ${submission.email}
- Project Type: ${submission.projectType}
- External Project: ${submission.externalProjectName}
- Internal Department: ${submission.internalDepartment}
- Claimed Amount (tax incl.): ${submission.claimedAmountTaxIncluded}
- Closing Month: ${submission.closingMonth}

ACTIVE VENDORS:
${JSON.stringify(vendorList, null, 2)}

ACTIVE CONTRACTS:
${JSON.stringify(contractList, null, 2)}

Instructions:
- Find the vendor whose name or aliases best match the payer name
- Then find the best matching contract for that vendor
- Set riskLevel: "OK" if vendor+contract matched and amount is within 10% of expected, "NEEDS_REVIEW" if unknown vendor or amount mismatch, "BLOCKED" if vendor found but no active contract
- Set reviewerRecommendation to the vendor's defaultReviewer if known, otherwise "Accounting Lead"
- Confidence: 1.0 = exact match, 0.5 = partial/fuzzy, 0.0 = no match

Respond with ONLY this JSON (no markdown, no extra text):
{
  "vendorId": "<id or null>",
  "contractId": "<id or null>",
  "confidence": <0.0 to 1.0>,
  "riskLevel": "<OK | NEEDS_REVIEW | BLOCKED>",
  "reviewerRecommendation": "<name>",
  "reasoning": "<brief explanation>"
}`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "{}";

  try {
    const parsed = JSON.parse(text) as AIMatchResult;
    // Validate required fields with fallbacks
    return {
      vendorId: parsed.vendorId ?? null,
      contractId: parsed.contractId ?? null,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
      riskLevel: (["OK", "NEEDS_REVIEW", "BLOCKED"] as RiskLevel[]).includes(parsed.riskLevel)
        ? parsed.riskLevel
        : "NEEDS_REVIEW",
      reviewerRecommendation: parsed.reviewerRecommendation || "Accounting Lead",
      reasoning: parsed.reasoning || "No reasoning provided",
    };
  } catch {
    return {
      vendorId: null,
      contractId: null,
      confidence: 0,
      riskLevel: "NEEDS_REVIEW",
      reviewerRecommendation: "Accounting Lead",
      reasoning: "AI matching failed — manual review required",
    };
  }
}
