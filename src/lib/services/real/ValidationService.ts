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
import type { IDriveService, IVendorService, IContractService, IValidationService } from "../types";
import { safeValidationResult } from "@/lib/validation/invoiceValidator";
import { extractFromPdf } from "../ai/pdfExtractor";
import { enrichWithRisk } from "../riskEnrichment";

export class RealValidationService implements IValidationService {
  constructor(
    private drive: IDriveService,
    private vendorService: IVendorService,
    private contractService: IContractService
  ) {}

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

    const duplicateDetected = false;
    const base = safeValidationResult(submission, extracted, pdfAccessible, duplicateDetected);
    return enrichWithRisk(base, submission, this.vendorService, this.contractService);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}
