// src/app/api/invoices/approve/route.ts
// POST /api/invoices/approve
// Manually approves a REVIEW_REQUIRED invoice, setting statusCode → READY
// and recording humanApproved + approvedBy on the validation result.

import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionId, approvedBy } = body as {
    submissionId?: string;
    approvedBy?: string;
  };

  if (!submissionId) {
    return NextResponse.json({ error: "Missing submissionId" }, { status: 400 });
  }

  try {
    const storageSvc = getStorageService();
    const [existing] = await storageSvc.loadValidationResults([submissionId]);

    if (!existing) {
      return NextResponse.json(
        { error: "No validation result found for this submission. Run validation first." },
        { status: 404 }
      );
    }

    const approved = {
      ...existing,
      statusCode: "READY" as const,
      humanApproved: true,
      approvedBy: approvedBy ?? "unknown",
    };

    await storageSvc.saveValidationResult(approved);
    return NextResponse.json({ result: approved });
  } catch (err) {
    console.error("[POST /api/invoices/approve]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
