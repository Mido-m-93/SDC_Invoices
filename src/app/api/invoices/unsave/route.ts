// src/app/api/invoices/unsave/route.ts
// POST /api/invoices/unsave
// Reverses Save: moves the filed PDF to the Google Drive trash (recoverable for
// 30 days) and removes the filed-document record, so the invoice goes back to
// "validated, not saved" and can be saved again. Refuses while the invoice is
// marked paid (undo that first).

import { NextRequest, NextResponse } from "next/server";
import { getDriveService, getStorageService } from "@/lib/services";
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
      return NextResponse.json({ error: "This invoice is not saved." }, { status: 404 });
    }
    if (existing.paidAt) {
      return NextResponse.json({ error: "Undo Paid first, then undo Save." }, { status: 409 });
    }

    // Trash the Drive file first: if that fails the record stays, so the invoice
    // never looks unsaved while its file is still sitting in Drive (which would
    // make a re-save fail as a duplicate).
    if (existing.driveFileId) {
      try {
        await getDriveService().trashFile(existing.driveFileId);
      } catch (err) {
        console.error("[POST /api/invoices/unsave] trashing the Drive file failed", err);
        return NextResponse.json(
          { error: "Could not move the file in Google Drive to the trash. Nothing was changed.", detail: String(err) },
          { status: 502 }
        );
      }
    }

    await storageSvc.deleteFiledDocument(submissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/invoices/unsave]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
