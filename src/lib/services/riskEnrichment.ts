// lib/services/riskEnrichment.ts
// Shared async risk enrichment — used by both Mock and Real validation services.
// Reads vendor/contract data from whatever service is injected (mock or Supabase).

import type { InvoiceValidationResult, InvoiceSubmission, Contract, RiskLevel } from "@/types";
import type { IVendorService, IContractService } from "./types";
import { parseCurrencyString } from "@/lib/validation/invoiceValidator";

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export async function enrichWithRisk(
  result: InvoiceValidationResult,
  submission: InvoiceSubmission,
  vendorService: IVendorService,
  contractService: IContractService
): Promise<InvoiceValidationResult> {
  const [vendors, contracts] = await Promise.all([
    vendorService.listVendors(),
    contractService.listContracts(),
  ]);

  const payerNorm = normalizeForMatch(submission.payerName);

  const vendor = vendors.find(
    (v) =>
      v.status === "active" &&
      [v.name, ...v.aliases].some((n) => normalizeForMatch(n) === payerNorm)
  );

  const vendorMatched = !!vendor;
  let contractMatched = false;
  let contractId: string | undefined;
  let activeContract: Contract | undefined;

  if (vendor) {
    const today = new Date().toISOString().slice(0, 10);
    activeContract = contracts.find(
      (c) =>
        c.vendorId === vendor.id &&
        c.status === "active" &&
        (!c.startDate || c.startDate <= today) &&
        (!c.endDate || c.endDate >= today)
    );
    contractMatched = !!activeContract;
    contractId = activeContract?.id;
  }

  let riskLevel: RiskLevel;
  let reviewerRecommendation: string;

  if (!vendorMatched) {
    riskLevel = "NEEDS_REVIEW";
    reviewerRecommendation = "Accounting Lead";
  } else if (!contractMatched) {
    riskLevel = "BLOCKED";
    reviewerRecommendation = vendor!.defaultReviewer || "Accounting Lead";
  } else if (activeContract && activeContract.expectedMonthlyAmount > 0) {
    const claimed   = parseCurrencyString(submission.claimedAmountTaxIncluded) ?? 0;
    const tolerance = activeContract.expectedMonthlyAmount * 0.1;
    const amountOk  = Math.abs(claimed - activeContract.expectedMonthlyAmount) <= tolerance;
    riskLevel = (result.statusCode === "READY" && amountOk) ? "OK" : "NEEDS_REVIEW";
    reviewerRecommendation = vendor!.defaultReviewer || "Accounting";
  } else {
    riskLevel = result.statusCode === "READY" ? "OK" : "NEEDS_REVIEW";
    reviewerRecommendation = vendor!.defaultReviewer || "Accounting";
  }

  return {
    ...result,
    vendorMatched,
    contractMatched,
    contractId,
    riskLevel,
    reviewerRecommendation,
  };
}
