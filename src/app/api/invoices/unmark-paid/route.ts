// src/app/api/invoices/unmark-paid/route.ts
// POST /api/invoices/unmark-paid
// Reverses mark-paid: clears the paid mark and date on a filed invoice.
// The filed document (Drive file) itself is kept, so it goes back to "Saved".

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
      return NextResponse.json({ error: "No filed document found for this submission." }, { status: 404 });
    }
    if (!existing.paidAt) {
      return NextResponse.json({ error: "This invoice is not marked as paid." }, { status: 409 });
    }

    await storageSvc.markFiledDocumentUnpaid(submissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/invoices/unmark-paid]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
