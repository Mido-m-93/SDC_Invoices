// ─────────────────────────────────────────────────────────────────────────────
// lib/services/real/ValidationService.ts — Real PDF validation
//
// Replaces MockValidationService when NEXT_PUBLIC_USE_MOCK_VALIDATION=false.
//
// For each submission:
//   1. Fetch the PDF bytes from Google Drive via IDriveService
//   2. Extract structured fields (Google Document AI → pdf-parse + Claude)
//   3. Run the existing rule-based validator (invoiceValidator.ts)
// ─────────────────────────────────────────────────────────────────────────────

import type { InvoiceSubmission, InvoiceValidationResult } from "@/types";
import type { IDriveService, IValidationService } from "../types";
import { safeValidationResult } from "@/lib/validation/invoiceValidator";
import { extractFromPdf } from "../ai/pdfExtractor";

export class RealValidationService implements IValidationService {
  constructor(private drive: IDriveService) {}

  async validate(submission: InvoiceSubmission): Promise<InvoiceValidationResult> {
    let pdfAccessible = false;
    let extracted = null;

    if (submission.invoiceAttachment) {
      try {
        const attachment = await this.drive.fetchAttachment(submission.invoiceAttachment);
        if (attachment?.data?.length) {
          pdfAccessible = true;
          extracted = await extractFromPdf(attachment.data);
        }
      } catch (err) {
        console.error(`[ValidationService] Failed to fetch/extract PDF for ${submission.id}:`, err);
      }
    }

    // Duplicate detection requires a Drive folder scan — skipped here;
    // the filing step handles duplicates before upload.
    const duplicateDetected = false;

    return safeValidationResult(submission, extracted, pdfAccessible, duplicateDetected);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}
