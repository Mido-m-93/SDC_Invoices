// lib/services/riskEnrichment.ts
// Shared async risk enrichment — checks whether the invoice submitter is a
// registered, active member of the organisation.

import type { InvoiceValidationResult, InvoiceSubmission, RiskLevel } from "@/types";
import type { IMemberService } from "./types";

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export async function enrichWithRisk(
  result: InvoiceValidationResult,
  submission: InvoiceSubmission,
  memberService: IMemberService,
): Promise<InvoiceValidationResult> {
  const members = await memberService.listMembers();

  const payerNorm  = normalizeForMatch(submission.payerName);
  const emailNorm  = (submission.email ?? "").toLowerCase().trim();

  const member = members.find(
    (m) =>
      normalizeForMatch(m.displayName) === payerNorm ||
      (emailNorm && m.email.toLowerCase() === emailNorm)
  );

  const vendorMatched   = !!member;
  const contractMatched = member?.status === "active";

  let riskLevel: RiskLevel;
  let reviewerRecommendation: string;

  if (!vendorMatched) {
    riskLevel = "NEEDS_REVIEW";
    reviewerRecommendation = "Accounting Lead";
  } else if (!contractMatched) {
    riskLevel = "BLOCKED";
    reviewerRecommendation = "Accounting Lead";
  } else {
    riskLevel = result.statusCode === "READY" ? "OK" : "NEEDS_REVIEW";
    reviewerRecommendation = member!.department || "Accounting";
  }

  return {
    ...result,
    vendorMatched,
    contractMatched,
    riskLevel,
    reviewerRecommendation,
  };
}
