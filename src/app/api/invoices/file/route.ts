export const dynamic = "force-dynamic";

// src/app/api/invoices/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getDriveService,
  getStorageService,
} from "@/lib/services";
import { DEFAULT_CONFIG, buildMonthFolderName } from "@/config/defaults";
import { generateId } from "@/lib/utils";
import type { InvoiceValidationResult, FiledDocument } from "@/types";

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { validation } = body as { validation?: InvoiceValidationResult };

  if (!validation) {
    return NextResponse.json(
      { error: "Provide 'validation' in body" },
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

    // Fetch attachment (mock returns dummy bytes)
    const attachment = await driveSvc.fetchAttachment("mock-url");
    if (!attachment) {
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
      originalFilename: attachment.filename,
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
