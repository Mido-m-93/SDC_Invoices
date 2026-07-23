// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/contractExtractor.ts — member contract PDF field extraction
//
// Deliberately kept in its own module, separate from pdfExtractor.ts. That file
// dynamically imports pdfjs-dist for invoice text extraction, and pdfjs-dist
// throws "ReferenceError: DOMMatrix is not defined" the moment it's imported
// in this serverless runtime — even a lazy `await import(...)` inside an
// unrelated function can crash module initialization for anything importing
// the same file. Extraction here goes straight to OpenAI's vision-capable
// Files/Responses API instead, so this module never touches pdfjs at all.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedContractFields {
  memberName: string | null;
  contractedAmount: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  paymentTerms: string | null;
  scope: string | null;
}

function parseCurrencyStr(str: string | null | undefined): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[¥￥,、\s円]/g, "").replace(/[^\d.]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseNumericField(val: unknown): number | null {
  if (typeof val === "number") return isNaN(val) ? null : val;
  if (typeof val === "string") return parseCurrencyStr(val);
  return null;
}

const CONTRACT_EXTRACT_PROMPT = `Extract service contract fields from this document and return ONLY valid JSON — no markdown, no explanation.

Return exactly this JSON:
{
  "memberName": "contractor / service provider name, or null",
  "contractedAmount": number or null,
  "contractStart": "YYYY-MM-DD or null",
  "contractEnd": "YYYY-MM-DD or null",
  "paymentTerms": "e.g. monthly / per project / one-time, or null",
  "scope": "brief work scope description, max 100 chars, or null"
}

Rules:
- contractedAmount is the agreed payment / fee amount (look for 報酬, 委託料, fee, amount, 金額)
- contractedAmount must be a plain number with no currency symbols or commas
- Dates must be YYYY-MM-DD
- Return null for any field you cannot find with confidence`;

function parseContractResponse(text: string): ExtractedContractFields {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    return { memberName: null, contractedAmount: null, contractStart: null, contractEnd: null, paymentTerms: null, scope: null };
  }
  return {
    memberName:       typeof parsed.memberName === "string" ? parsed.memberName : null,
    contractedAmount: parseNumericField(parsed.contractedAmount),
    contractStart:    typeof parsed.contractStart === "string" ? parsed.contractStart : null,
    contractEnd:      typeof parsed.contractEnd === "string" ? parsed.contractEnd : null,
    paymentTerms:     typeof parsed.paymentTerms === "string" ? parsed.paymentTerms : null,
    scope:            typeof parsed.scope === "string" ? parsed.scope : null,
  };
}

export async function extractContractFields(pdfBytes: Uint8Array): Promise<ExtractedContractFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const plainBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  const fileBlob = new File([plainBuffer], "contract.pdf", { type: "application/pdf" });
  const uploadedFile = await client.files.create({ file: fileBlob, purpose: "user_data" });

  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploadedFile.id },
            { type: "input_text", text: CONTRACT_EXTRACT_PROMPT },
          ],
        },
      ],
      max_output_tokens: 512,
    });
    return parseContractResponse(response.output_text ?? "{}");
  } finally {
    await client.files.delete(uploadedFile.id).catch((e: unknown) =>
      console.warn("[contractExtractor] File cleanup failed:", e)
    );
  }
}
