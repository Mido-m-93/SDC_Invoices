// src/app/api/invoices/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getValidationService, getStorageService, getVendorService, getContractService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { InvoiceSubmission, ProcessingRun, ProcessingLog } from "@/types";
import { matchSubmissionToVendorContract } from "@/lib/services/ai/matchingService";

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/validate
 * Body: { submission: InvoiceSubmission } | { submissions: InvoiceSubmission[] }
 * Validates one or more invoices, persists results, and records a processing run + logs.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submission, submissions, month, validatedBy } = body as {
    submission?: InvoiceSubmission;
    submissions?: InvoiceSubmission[];
    month?: string;
    validatedBy?: string;
  };

  const targets: InvoiceSubmission[] = submissions ?? (submission ? [submission] : []);

  if (!submission && !submissions) {
    return NextResponse.json(
      { error: "Provide 'submission' or 'submissions' in body" },
      { status: 400 }
    );
  }

  if (targets.length === 0) {
    return NextResponse.json({ count: 0, results: [] });
  }

  const runId = generateId();
  const startedAt = new Date().toISOString();
  const storageSvc = getStorageService();

  // Create run record as RUNNING
  const run: ProcessingRun = {
    id: runId,
    month: month ?? targets[0]?.closingMonth ?? "unknown",
    startedAt,
    completedAt: null,
    totalRows: targets.length,
    ready: 0,
    reviewRequired: 0,
    saved: 0,
    errors: 0,
    status: "RUNNING",
  };
  await storageSvc.saveRun(run);

  try {
    const validationSvc = getValidationService();
    const baseResults = await validationSvc.validateBatch(targets);

    // AI vendor/contract matching — runs in parallel for all submissions
    const [vendors, contracts] = await Promise.all([
      getVendorService().listVendors().catch((err) => {
        console.error("[validate] listVendors failed:", err);
        return [];
      }),
      getContractService().listContracts().catch((err) => {
        console.error("[validate] listContracts failed:", err);
        return [];
      }),
    ]);

    const aiMatches = await Promise.all(
      targets.map((sub) =>
        matchSubmissionToVendorContract(sub, vendors, contracts).catch((err) => {
          console.error(`[AI matching] failed for ${sub.id}:`, err);
          return null;
        })
      )
    );

    // Merge AI match results + audit user into validation results
    const results = baseResults.map((r, i) => {
      const ai = aiMatches[i];
      return {
        ...r,
        ...(validatedBy ? { validatedBy } : {}),
        ...(ai ? {
          vendorMatched: ai.vendorId !== null,
          contractMatched: ai.contractId !== null,
          contractId: ai.contractId ?? r.contractId,
          riskLevel: ai.riskLevel,
          reviewerRecommendation: ai.reviewerRecommendation,
        } : {}),
      };
    });

    // Persist validation results
    await Promise.all(results.map((r) => storageSvc.saveValidationResult(r)));

    // Build per-submission logs
    const logs: ProcessingLog[] = results.map((r) => ({
      id: generateId(),
      runId,
      submissionId: r.submissionId,
      step: "VALIDATION_COMPLETE" as const,
      result: r.statusCode === "READY"
        ? "OK"
        : r.statusCode === "REVIEW_REQUIRED"
        ? "WARNING"
        : "ERROR",
      message: r.issues.length > 0 ? r.issues.join(", ") : r.statusCode,
      timestamp: new Date().toISOString(),
    }));
    await Promise.all(logs.map((l) => storageSvc.appendLog(l)));

    // Count outcomes
    const ready         = results.filter((r) => r.statusCode === "READY").length;
    const reviewRequired = results.filter((r) => r.statusCode === "REVIEW_REQUIRED").length;
    const errors        = results.filter((r) =>
      !["READY", "REVIEW_REQUIRED", "ALREADY_PROCESSED", "DUPLICATE_FILE", "SAVED"].includes(r.statusCode)
    ).length;

    // Update run to COMPLETE
    const completedRun: ProcessingRun = {
      ...run,
      completedAt: new Date().toISOString(),
      ready,
      reviewRequired,
      errors,
      status: "COMPLETE",
    };
    await storageSvc.saveRun(completedRun);

    return NextResponse.json({ count: results.length, results });
  } catch (err) {
    console.error("[POST /api/invoices/validate]", err);
    // Mark run as FAILED
    await storageSvc.saveRun({ ...run, completedAt: new Date().toISOString(), status: "FAILED" });
    return NextResponse.json(
      { error: "Validation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
