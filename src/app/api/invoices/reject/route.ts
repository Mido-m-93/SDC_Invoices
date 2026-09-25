
// src/app/api/invoices/reject/route.ts
// POST /api/invoices/reject
// Manually rejects a REVIEW_REQUIRED invoice, recording humanRejected +
// rejectedBy on the validation result. Mirrors /api/invoices/approve —
// doesn't touch statusCode, so Save stays hidden (it only shows for
// READY/humanApproved).

import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionId, rejectedBy } = body as {
    submissionId?: string;
    rejectedBy?: string;
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

    const rejected = {
      ...existing,
      humanRejected: true,
      rejectedBy: rejectedBy ?? "unknown",
    };

    await storageSvc.saveValidationResult(rejected);
    return NextResponse.json({ result: rejected });
  } catch (err) {
    console.error("[POST /api/invoices/reject]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
