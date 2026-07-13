export const dynamic = "force-dynamic";

// src/app/api/invoices/file/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDriveService, getStorageService } from "@/lib/services";
import { DEFAULT_CONFIG, buildMonthFolderName } from "@/config/defaults";
import { generateId } from "@/lib/utils";
import type { InvoiceValidationResult, FiledDocument } from "@/types";

export const dynamic = 'force-dynamic';

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "root";

/**
 * POST /api/invoices/file/bulk
 * Body: { validations: InvoiceValidationResult[] }
 *
 * Files all READY or human-approved invoices in one request.
 * Returns per-invoice results so the caller knows which succeeded/failed.
 * âš  Phase 1: Only stores â€” never triggers payment.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { validations } = body as { validations?: InvoiceValidationResult[] };

  if (!Array.isArray(validations) || validations.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'validations' array in body" },
      { status: 400 }
    );
  }

  // Rule 10: only process READY or human-approved
  const eligible = validations.filter(
    (v) => v.statusCode === "READY" || v.humanApproved === true
  );
  const skipped = validations
    .filter((v) => v.statusCode !== "READY" && !v.humanApproved)
    .map((v) => ({ submissionId: v.submissionId, reason: `Status is ${v.statusCode}` }));

  const driveSvc = getDriveService();
  const storageSvc = getStorageService();
  const config = await storageSvc.loadConfig().catch(() => DEFAULT_CONFIG);

  const filed: FiledDocument[] = [];
  const errors: { submissionId: string; error: string }[] = [];

  for (const validation of eligible) {
    try {
      const folderName =
        validation.targetFolderPath || buildMonthFolderName("", config);
      const folderId = await driveSvc.ensureMonthFolder({
        rootFolderId: ROOT_FOLDER_ID,
        folderName,
      });

      const isDuplicate = await driveSvc.checkDuplicate({
        folderId,
        filename: validation.proposedFilename,
      });

      if (isDuplicate) {
        errors.push({
          submissionId: validation.submissionId,
          error: `Duplicate file: ${validation.proposedFilename}`,
        });
        continue;
      }

      const attachment = await driveSvc.fetchAttachment("mock-url");
      if (!attachment) {
        errors.push({
          submissionId: validation.submissionId,
          error: "Could not fetch attachment",
        });
        continue;
      }

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
      filed.push(filedDoc);
    } catch (err) {
      errors.push({
        submissionId: validation.submissionId,
        error: String(err),
      });
    }
  }

  return NextResponse.json({
    success: true,
    filed,
    skipped,
    errors,
    summary: {
      total: validations.length,
      filed: filed.length,
      skipped: skipped.length,
      errors: errors.length,
    },
  });
}
