import { NextRequest, NextResponse } from "next/server";
import { getExpenseService, getStorageService } from "@/lib/services";
import { checkMemberBySharePointContracts } from "@/lib/services/real/SharePointContractService";
import { generateId } from "@/lib/utils";
import type { ProcessingRun, ProcessingLog } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const storageSvc = getStorageService();
  const runId = generateId();
  const startedAt = new Date().toISOString();

  try {
    const svc   = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const run: ProcessingRun = {
      id: runId,
      month: claim.expenseDate?.slice(0, 7) ?? "unknown",
      startedAt,
      completedAt: null,
      totalRows: 1,
      ready: 0,
      reviewRequired: 0,
      saved: 0,
      errors: 0,
      status: "RUNNING",
      entityType: "expense",
    };
    await storageSvc.saveRun(run);

    // Run receipt validation and SharePoint member check in parallel
    const [result, spResult] = await Promise.all([
      svc.validateClaim(claim),
      checkMemberBySharePointContracts(claim.submittedBy).catch(() => ({
        matched: false,
        contractFileName: null,
        contractInfo: null,
      })),
    ]);

    const fullResult = {
      ...result,
      memberMatched:    spResult.matched,
      contractFileName: spResult.contractFileName ?? null,
    };

    // Persist extracted fields back to claim
    if (
      fullResult.extractedAmount !== null ||
      fullResult.extractedDate ||
      fullResult.extractedVendor
    ) {
      await svc.saveClaim({
        ...claim,
        extractedAmount:  fullResult.extractedAmount,
        extractedDate:    fullResult.extractedDate,
        extractedVendor:  fullResult.extractedVendor,
        policyViolations: fullResult.policyViolations,
        updatedAt:        new Date().toISOString(),
      });
    }

    const logResult: ProcessingLog["result"] =
      fullResult.policyViolations.length > 0 ? "WARNING" : fullResult.receiptMissing ? "ERROR" : "OK";
    const log: ProcessingLog = {
      id: generateId(),
      runId,
      submissionId: claim.id,
      step: "VALIDATION_COMPLETE",
      result: logResult,
      message: fullResult.policyViolations.length > 0
        ? fullResult.policyViolations.join(", ")
        : fullResult.statusCode,
      timestamp: new Date().toISOString(),
    };
    await storageSvc.appendLog(log);

    await storageSvc.saveRun({
      ...run,
      completedAt: new Date().toISOString(),
      status: "COMPLETE",
      ready: logResult === "OK" ? 1 : 0,
      reviewRequired: logResult === "WARNING" ? 1 : 0,
      errors: logResult === "ERROR" ? 1 : 0,
    });

    return NextResponse.json({
      result: fullResult,
      _debug: { receiptUrl: claim.receiptUrl ?? null },
    });
  } catch (err) {
    await storageSvc.saveRun({
      id: runId,
      month: "unknown",
      startedAt,
      completedAt: new Date().toISOString(),
      totalRows: 1,
      ready: 0,
      reviewRequired: 0,
      saved: 0,
      errors: 1,
      status: "FAILED",
      entityType: "expense",
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
