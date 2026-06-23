import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceSubmission, Member, RiskLevel } from "@/types";

export interface AIMatchResult {
  vendorId: string | null;   // matched member id (null = submitter unknown)
  contractId: string | null; // same member id when active (null = inactive/unknown)
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

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[^\w]/g, "");
}

export async function matchSubmissionToMember(
  submission: InvoiceSubmission,
  members: Member[]
): Promise<AIMatchResult> {
  const activeMembers = members.filter((m) => m.status === "active");

  // Fast-path: exact email match (no AI call needed)
  const emailNorm = (submission.email ?? "").toLowerCase().trim();
  if (emailNorm) {
    const byEmail = members.find((m) => m.email.toLowerCase().trim() === emailNorm);
    if (byEmail) {
      const isActive = byEmail.status === "active";
      return {
        vendorId: byEmail.id,
        contractId: isActive ? byEmail.id : null,
        confidence: 1.0,
        riskLevel: isActive ? "OK" : "BLOCKED",
        reviewerRecommendation: byEmail.department || "Accounting",
        reasoning: `Exact email match: ${emailNorm}`,
      };
    }
  }

  // Fast-path: exact normalised name match (no AI call needed)
  const nameNorm = normalise(submission.payerName ?? "");
  if (nameNorm) {
    const byName = members.find((m) => normalise(m.displayName) === nameNorm);
    if (byName) {
      const isActive = byName.status === "active";
      return {
        vendorId: byName.id,
        contractId: isActive ? byName.id : null,
        confidence: 1.0,
        riskLevel: isActive ? "OK" : "BLOCKED",
        reviewerRecommendation: byName.department || "Accounting",
        reasoning: `Exact name match: ${submission.payerName}`,
      };
    }
  }

  const memberList = members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    department: m.department,
    role: m.role,
    status: m.status,
  }));

  const systemPrompt = `You are a member matching assistant for an invoice processing system.
Given an invoice submission, identify whether the submitter is a registered member of the organisation.
Consider: name similarity (including Japanese/English variants), and email match.
Respond only with a valid JSON object matching the exact schema requested.`;

  const userPrompt = `Match this invoice submission to a registered member.

SUBMISSION:
- Payer Name: ${submission.payerName}
- Email: ${submission.email}
- Internal Department: ${submission.internalDepartment}
- Closing Month: ${submission.closingMonth}

REGISTERED MEMBERS (${members.length} total, ${activeMembers.length} active):
${JSON.stringify(memberList, null, 2)}

Instructions:
- Find the member whose displayName or email best matches the payer name / email
- vendorId = the matched member's id, or null if no match found
- contractId = same as vendorId when the matched member's status is "active", otherwise null
- Set riskLevel: "OK" if member found and active, "BLOCKED" if found but inactive, "NEEDS_REVIEW" if no member found
- Set reviewerRecommendation to the member's department if known, otherwise "Accounting Lead"
- Confidence: 1.0 = exact match, 0.5 = partial/fuzzy, 0.0 = no match

Respond with ONLY this JSON (no markdown, no extra text):
{
  "vendorId": "<member id or null>",
  "contractId": "<member id if active, else null>",
  "confidence": <0.0 to 1.0>,
  "riskLevel": "<OK | NEEDS_REVIEW | BLOCKED>",
  "reviewerRecommendation": "<department or Accounting Lead>",
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
