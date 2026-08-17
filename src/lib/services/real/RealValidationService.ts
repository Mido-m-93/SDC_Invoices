import "server-only";
import type { IValidationService } from "../types";
import type { InvoiceSubmission, InvoiceValidationResult } from "@/types";
import { getStorageService } from "../index";
import { safeValidationResult } from "@/lib/validation/invoiceValidator";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { extractFromPdf } from "../ai/pdfExtractor";
import { downloadSharePointFile } from "./SharePointContractService";

function isPdf(bytes: Uint8Array): boolean {
  // PDF files start with the magic bytes "%PDF"
  return bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 &&
    bytes[2] === 0x44 && bytes[3] === 0x46;
}

async function fetchPdfBytes(url: string): Promise<{ data: Uint8Array; ok: boolean }> {
  // SharePoint URLs (from Microsoft Forms attachments) require Graph API auth.
  // A plain fetch() follows the auth redirect and returns an HTML login page —
  // isPdf() below guards against feeding that HTML to Claude.
  const hasAzureCreds = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET
  );
  const isSharePoint = url.includes("sharepoint.com") || url.includes("1drv.ms") || url.includes("onedrive.live.com");

  if (hasAzureCreds && isSharePoint) {
    try {
      const data = await downloadSharePointFile(url);
      if (!isPdf(data)) {
        console.warn("[RealValidationService] SharePoint download did not return a PDF:", url.slice(0, 120));
        return { data: new Uint8Array(), ok: false };
      }
      console.log(`[RealValidationService] SharePoint PDF downloaded: ${data.length} bytes`);
      return { data, ok: true };
    } catch (err) {
      console.warn("[RealValidationService] SharePoint download failed:", err);
      return { data: new Uint8Array(), ok: false };
    }
  }

  // Fallback: unauthenticated fetch (public links, Google Drive shares, etc.)
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: new Uint8Array(), ok: false };
    const data = new Uint8Array(await res.arrayBuffer());
    if (!isPdf(data)) {
      console.warn("[RealValidationService] Direct fetch did not return a PDF (auth redirect?):", url.slice(0, 120));
      return { data: new Uint8Array(), ok: false };
    }
    console.log(`[RealValidationService] Direct fetch PDF: ${data.length} bytes`);
    return { data, ok: true };
  } catch {
    return { data: new Uint8Array(), ok: false };
  }
}

export class RealValidationService implements IValidationService {
  async validate(submission: InvoiceSubmission): Promise<InvoiceValidationResult> {
    const config = await getStorageService().loadConfig().catch(() => DEFAULT_CONFIG);

    if (!submission.invoiceAttachment) {
      return safeValidationResult(submission, null, false, false, config);
    }

    const { data: pdfBytes, ok: pdfAccessible } = await fetchPdfBytes(submission.invoiceAttachment);

    let extracted = null;
    if (pdfAccessible && pdfBytes.length > 0) {
      extracted = await extractFromPdf(pdfBytes).catch((err) => {
        console.error("[RealValidationService] PDF extraction failed:", err);
        return null;
      });
      console.log("[RealValidationService] Extraction result:", JSON.stringify(extracted));
    }

    return safeValidationResult(submission, extracted, pdfAccessible, false, config);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}
