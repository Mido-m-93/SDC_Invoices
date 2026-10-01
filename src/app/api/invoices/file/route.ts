
// src/app/api/invoices/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getDriveService,
  getStorageService,
} from "@/lib/services";
import { DEFAULT_CONFIG, buildMonthFolderName } from "@/config/defaults";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import { fetchPdfBytes } from "@/lib/services/real/RealValidationService";
import type { InvoiceValidationResult, InvoiceSubmission, FiledDocument } from "@/types";

// Best-effort original filename from the source URL — falls back to the
// proposed filename when the URL has no usable name segment.
function guessOriginalFilename(url: string, fallback: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return last && last.includes(".") ? last : fallback;
  } catch {
    return fallback;
  }
}

export const dynamic = 'force-dynamic';

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "root";

/**
 * POST /api/invoices/file
 * Body: { submissionId: string, validation: InvoiceValidationResult }
 *
 * âš  Phase 1: Only stores â€” never triggers payment.
 * Requires validation.statusCode === "READY".
 */
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { validation, submission } = body as {
    validation?: InvoiceValidationResult;
    submission?: InvoiceSubmission;
  };

  if (!validation) {
    return NextResponse.json(
      { error: "Provide 'validation' in body" },
      { status: 400 }
    );
  }
  if (!submission?.invoiceAttachment) {
    return NextResponse.json(
      { error: "Provide 'submission' (with invoiceAttachment) in body" },
      { status: 400 }
    );
  }

  // Rule 10: only READY invoices, or ones explicitly approved by a human reviewer
  const canFile = validation.statusCode === "READY" || validation.humanApproved === true;
  if (!canFile) {
    return NextResponse.json(
      {
        error: "Cannot file invoice",
        reason: `Status is ${validation.statusCode}. Only READY invoices or human-approved invoices can be filed.`,
      },
      { status: 422 }
    );
  }

  try {
    const driveSvc = getDriveService();
    const storageSvc = getStorageService();
    const config = await storageSvc.loadConfig().catch(() => DEFAULT_CONFIG);

    // Ensure target folder exists
    const folderName = validation.targetFolderPath || buildMonthFolderName("", config);
    const folderId = await driveSvc.ensureMonthFolder({
      rootFolderId: ROOT_FOLDER_ID,
      folderName,
    });

    // Check for duplicates
    const isDuplicate = await driveSvc.checkDuplicate({
      folderId,
      filename: validation.proposedFilename,
    });

    if (isDuplicate) {
      return NextResponse.json(
        { error: "Duplicate file detected", filename: validation.proposedFilename },
        { status: 409 }
      );
    }

    // Fetch the real source attachment (SharePoint-hosted) — not a Google
    // Drive file, so this uses the same downloader RealValidationService
    // uses, not driveSvc's Google-Drive-only fetchAttachment().
    const attachment = await fetchPdfBytes(submission.invoiceAttachment!);
    if (!attachment.ok) {
      return NextResponse.json(
        { error: "Could not fetch attachment" },
        { status: 502 }
      );
    }

    // Upload
    const { fileId, webViewLink } = await driveSvc.uploadPdf({
      folderId,
      filename: validation.proposedFilename,
      data: attachment.data,
    });

    const filedDoc: FiledDocument = {
      submissionId: validation.submissionId,
      originalFilename: guessOriginalFilename(submission.invoiceAttachment!, validation.proposedFilename),
      newFilename: validation.proposedFilename,
      driveFolderId: folderId,
      driveFileId: fileId,
      driveWebViewLink: webViewLink,
      savedAt: new Date().toISOString(),
    };

    await storageSvc.saveFiledDocument(filedDoc);

    return NextResponse.json({ success: true, filedDocument: filedDoc });
  } catch (err) {
    console.error("[POST /api/invoices/file]", err);
    return NextResponse.json(
      { error: "Filing failed", detail: String(err) },
      { status: 500 }
    );
  }
}
