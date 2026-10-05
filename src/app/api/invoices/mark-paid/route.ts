// src/app/api/invoices/mark-paid/route.ts
// POST /api/invoices/mark-paid
// Marks an already-filed invoice as paid. Only meaningful once a
// filed_documents row exists (i.e. Save has run) — mirrors the equivalent
// expense claim flow.

import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionId } = body as { submissionId?: string };
  if (!submissionId) {
    return NextResponse.json({ error: "Missing submissionId" }, { status: 400 });
  }

  try {
    const storageSvc = getStorageService();
    const [existing] = await storageSvc.loadFiledDocuments([submissionId]);
    if (!existing) {
      return NextResponse.json(
        { error: "No filed document found for this submission. Save it first." },
        { status: 404 }
      );
    }

    await storageSvc.markFiledDocumentPaid(submissionId);
    return NextResponse.json({ ok: true, paidAt: new Date().toISOString() });
  } catch (err) {
    console.error("[POST /api/invoices/mark-paid]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
