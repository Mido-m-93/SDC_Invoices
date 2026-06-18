import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { IValidationService } from "../types";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  ExtractedInvoiceFields,
} from "@/types";
import { getStorageService } from "../index";
import { safeValidationResult } from "@/lib/validation/invoiceValidator";
import { DEFAULT_CONFIG } from "@/config/defaults";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_PROMPT = `You are an accounting assistant. Extract structured fields from this invoice PDF.
Return ONLY valid JSON with this exact shape (use null for any field you cannot find):
{
  "invoiceDate": "YYYY-MM-DD or Japanese date string or null",
  "subtotal": number or null,
  "taxAmount": number or null,
  "total": number or null,
  "taxRate": number or null,
  "payeeName": "string or null",
  "payerNameOnDoc": "string or null",
  "rawText": "all visible text from the invoice, up to 2000 chars"
}
For monetary amounts, return the numeric value (no currency symbols or commas).
If the document is not an invoice, still return the JSON shape with nulls.`;

async function extractFieldsWithClaude(
  pdfBase64: string
): Promise<ExtractedInvoiceFields> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: EXTRACT_PROMPT },
  ];
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });

  const raw = (message.content[0] as { type: string; text?: string }).text ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { invoiceDate: null, subtotal: null, taxAmount: null, total: null, taxRate: null, payeeName: null, payerNameOnDoc: null, rawText: raw };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtractedInvoiceFields>;
    return {
      invoiceDate: parsed.invoiceDate ?? null,
      subtotal: typeof parsed.subtotal === "number" ? parsed.subtotal : null,
      taxAmount: typeof parsed.taxAmount === "number" ? parsed.taxAmount : null,
      total: typeof parsed.total === "number" ? parsed.total : null,
      taxRate: typeof parsed.taxRate === "number" ? parsed.taxRate : null,
      payeeName: parsed.payeeName ?? null,
      payerNameOnDoc: parsed.payerNameOnDoc ?? null,
      rawText: parsed.rawText ?? "",
    };
  } catch {
    return { invoiceDate: null, subtotal: null, taxAmount: null, total: null, taxRate: null, payeeName: null, payerNameOnDoc: null, rawText: raw };
  }
}

async function fetchPdfAsBase64(url: string): Promise<{ data: string; ok: boolean }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: "", ok: false };
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return { data: b64, ok: true };
  } catch {
    return { data: "", ok: false };
  }
}

export class RealValidationService implements IValidationService {
  async validate(submission: InvoiceSubmission): Promise<InvoiceValidationResult> {
    const config = await getStorageService().loadConfig().catch(() => DEFAULT_CONFIG);

    if (!submission.invoiceAttachment) {
      return safeValidationResult(submission, null, false, false, config);
    }

    const { data: pdfBase64, ok: pdfAccessible } = await fetchPdfAsBase64(submission.invoiceAttachment);

    let extracted: ExtractedInvoiceFields | null = null;
    if (pdfAccessible && pdfBase64) {
      extracted = await extractFieldsWithClaude(pdfBase64).catch(() => null);
    }

    const duplicateDetected = false; // Drive duplicate check handled separately in file route
    return safeValidationResult(submission, extracted, pdfAccessible, duplicateDetected, config);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}
