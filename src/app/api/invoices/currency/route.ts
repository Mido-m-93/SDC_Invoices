// src/app/api/invoices/currency/route.ts
// PATCH /api/invoices/currency
// Updates the currency field on a stored invoice submission.

import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionId, month, currency } = body as {
    submissionId?: string;
    month?: string;
    currency?: string;
  };

  if (!submissionId || !month || !currency) {
    return NextResponse.json({ error: "Missing submissionId, month, or currency" }, { status: 400 });
  }

  try {
    await getStorageService().patchSubmissionCurrency(submissionId, month, currency);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/invoices/currency]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
