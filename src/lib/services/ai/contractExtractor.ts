// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/contractExtractor.ts — member contract PDF field extraction
//
// Groq only (no OpenAI): text is extracted locally via unpdf, then parsed by
// Groq's LLM — same pattern as invoice extraction in pdfExtractor.ts. Scanned
// (image-only) contracts go through a vision model instead — see
// extractContractFieldsFromImage — and come back flagged `needsReview: true`
// since a vision model reading a scanned document is materially less
// reliable on exact dates/amounts than the text path, and can hallucinate a
// value rather than fail cleanly.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedContractFields {
  memberName: string | null;
  contractedAmount: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  paymentTerms: string | null;
  scope: string | null;
  // True only for fields read off a scanned image via the vision model —
  // callers should surface these for a human to confirm rather than trusting
  // them the way text-extracted fields are trusted.
  needsReview: boolean;
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

function parseContractResponse(text: string, needsReview = false): ExtractedContractFields {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    return { memberName: null, contractedAmount: null, contractStart: null, contractEnd: null, paymentTerms: null, scope: null, needsReview };
  }
  return {
    memberName:       typeof parsed.memberName === "string" ? parsed.memberName : null,
    contractedAmount: parseNumericField(parsed.contractedAmount),
    contractStart:    typeof parsed.contractStart === "string" ? parsed.contractStart : null,
    contractEnd:      typeof parsed.contractEnd === "string" ? parsed.contractEnd : null,
    paymentTerms:     typeof parsed.paymentTerms === "string" ? parsed.paymentTerms : null,
    scope:            typeof parsed.scope === "string" ? parsed.scope : null,
    needsReview,
  };
}

let _client: import("groq-sdk").default | undefined;
async function getClient() {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
    const Groq = (await import("groq-sdk")).default;
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

async function extractViaGroq(rawText: string): Promise<ExtractedContractFields> {
  if (!rawText.trim()) return parseContractResponse("{}");
  const client = await getClient();
  const response = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `${CONTRACT_EXTRACT_PROMPT}\n\nDOCUMENT TEXT:\n${rawText.slice(0, 8000)}`,
      },
    ],
  });
  return parseContractResponse(response.choices[0]?.message?.content ?? "{}");
}

export async function extractContractFields(pdfBytes: Uint8Array): Promise<ExtractedContractFields> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return extractViaGroq(text);
}

// Scanned contract images (.jpg/.png) — read via a Groq vision model instead
// of the text pipeline above. Flagged `needsReview: true` unconditionally:
// a vision model reading a scanned legal document is meaningfully less
// reliable on exact dates/amounts than the text path, so the caller should
// treat these fields as a draft for a human to confirm, not a fact.
export async function extractContractFieldsFromImage(
  imageBytes: Uint8Array,
  mimeType: string,
  _filename: string,
): Promise<ExtractedContractFields> {
  try {
    const client = await getClient();
    const base64 = Buffer.from(imageBytes).toString("base64");
    const response = await client.chat.completions.create({
      model: "qwen/qwen3.8-27b",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CONTRACT_EXTRACT_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    });
    return parseContractResponse(response.choices[0]?.message?.content ?? "{}", true);
  } catch (err) {
    console.warn("[contractExtractor] vision extraction failed:", err);
    return parseContractResponse("{}", true);
  }
}

// Word contracts (.doc/.docx) — extract plain text locally (mammoth, pure JS,
// no native deps) and send that as text, same as the PDF path above.
export async function extractContractFieldsFromDocx(docxBytes: Uint8Array): Promise<ExtractedContractFields> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(docxBytes);
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  return extractViaGroq(rawText);
}

// True only if at least one real field was extracted — lets a caller decide
// whether to fall back to trying another file (e.g. a .docx sitting next to
// a .pdf that turned out unreadable) instead of accepting an all-null result.
export function hasAnyContractField(fields: ExtractedContractFields | null): boolean {
  if (!fields) return false;
  return !!(fields.contractedAmount || fields.contractStart || fields.contractEnd || fields.scope || fields.paymentTerms);
}
