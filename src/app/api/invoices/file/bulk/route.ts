
// src/app/api/invoices/file/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDriveService, getStorageService } from "@/lib/services";
import { DEFAULT_CONFIG, buildMonthFolderName } from "@/config/defaults";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import { fetchPdfBytes } from "@/lib/services/real/RealValidationService";
import type { InvoiceValidationResult, InvoiceSubmission, FiledDocument } from "@/types";

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
 * POST /api/invoices/file/bulk
 * Body: { validations: InvoiceValidationResult[] }
 *
 * Files all READY or human-approved invoices in one request.
 * Returns per-invoice results so the caller knows which succeeded/failed.
 * âš  Phase 1: Only stores â€” never triggers payment.
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

  const { validations, submissions } = body as {
    validations?: InvoiceValidationResult[];
    submissions?: InvoiceSubmission[];
  };

  if (!Array.isArray(validations) || validations.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'validations' array in body" },
      { status: 400 }
    );
  }
  if (!Array.isArray(submissions) || submissions.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'submissions' array in body" },
      { status: 400 }
    );
  }
  const submissionById = new Map(submissions.map((s) => [s.id, s]));

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
      const submission = submissionById.get(validation.submissionId);
      if (!submission?.invoiceAttachment) {
        errors.push({
          submissionId: validation.submissionId,
          error: "No matching submission (with invoiceAttachment) provided",
        });
        continue;
      }

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

      // Fetch the real source attachment (SharePoint-hosted) — same
      // downloader RealValidationService uses, not driveSvc's
      // Google-Drive-only fetchAttachment().
      const attachment = await fetchPdfBytes(submission.invoiceAttachment);
      if (!attachment.ok) {
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
        originalFilename: guessOriginalFilename(submission.invoiceAttachment, validation.proposedFilename),
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
