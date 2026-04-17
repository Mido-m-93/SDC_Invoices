// src/app/api/invoices/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getValidationService, getStorageService } from "@/lib/services";
import type { InvoiceSubmission } from "@/types";

/**
 * POST /api/invoices/validate
 * Body: { submission: InvoiceSubmission } | { submissions: InvoiceSubmission[] }
 * Validates one or more invoices and persists the results.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submission, submissions } = body as {
    submission?: InvoiceSubmission;
    submissions?: InvoiceSubmission[];
  };

  const targets: InvoiceSubmission[] = submissions ?? (submission ? [submission] : []);

  if (targets.length === 0) {
    return NextResponse.json(
      { error: "Provide 'submission' or 'submissions' in body" },
      { status: 400 }
    );
  }

  try {
    const validationSvc = getValidationService();
    const storageSvc = getStorageService();

    const results = await validationSvc.validateBatch(targets);
    await Promise.all(results.map((r) => storageSvc.saveValidationResult(r)));

    return NextResponse.json({ count: results.length, results });
  } catch (err) {
    console.error("[POST /api/invoices/validate]", err);
    return NextResponse.json(
      { error: "Validation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
