import "server-only";
import OpenAI from "openai";

export interface ExtractedProposalFields {
  clientName: string | null;
  projectName: string | null;
  estimatedAmount: number | null;
  currency: string;
  proposalDate: string | null;
}

const PROPOSAL_EXTRACT_PROMPT = `Extract proposal/quote fields from this document and return ONLY valid JSON — no markdown, no explanation.

Return exactly this JSON:
{
  "clientName": "client or company name this proposal is addressed to, or null",
  "projectName": "project or service title, or null",
  "estimatedAmount": number or null,
  "currency": "JPY, USD, etc — default JPY if unclear",
  "proposalDate": "YYYY-MM-DD or null"
}

Rules:
- clientName: the recipient / client / customer this proposal is for
- estimatedAmount: search the ENTIRE document, not just text near the client/title — a total or fee is often stated elsewhere (a summary line, a pricing table, a signature block). Look for both English cues (fee, amount, total, budget, quote, contract value) and Japanese cues (見積, 見積金額, 金額, 合計, 月額, 予算, 費用, 契約金額). Only return null if truly no monetary figure appears anywhere in the document.
- estimatedAmount must be a plain number with no currency symbols or commas
- currency: infer from ¥/￥/円 → JPY, $ → USD; default JPY
- proposalDate: the document date or issue date
- Return null for any field you cannot find with confidence`;

function parseCurrencyStr(str: string): number | null {
  const cleaned = str.replace(/[¥￥,、\s円]/g, "").replace(/[^\d.]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseNumericField(val: unknown): number | null {
  if (typeof val === "number") return isNaN(val) ? null : val;
  if (typeof val === "string") return parseCurrencyStr(val);
  return null;
}

function parseResponse(text: string): ExtractedProposalFields {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    return { clientName: null, projectName: null, estimatedAmount: null, currency: "JPY", proposalDate: null };
  }
  return {
    clientName: typeof parsed.clientName === "string" ? parsed.clientName : null,
    projectName: typeof parsed.projectName === "string" ? parsed.projectName : null,
    estimatedAmount: parseNumericField(parsed.estimatedAmount),
    currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : "JPY",
    proposalDate: typeof parsed.proposalDate === "string" ? parsed.proposalDate : null,
  };
}

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export async function extractProposalFromPdf(pdfBytes: Uint8Array): Promise<ExtractedProposalFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const client = getClient();
  const plainBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  const fileBlob = new File([plainBuffer], "proposal.pdf", { type: "application/pdf" });
  const uploadedFile = await client.files.create({ file: fileBlob, purpose: "user_data" });
  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: [{ type: "input_file", file_id: uploadedFile.id }, { type: "input_text", text: PROPOSAL_EXTRACT_PROMPT }] }],
      max_output_tokens: 512,
    });
    return parseResponse(response.output_text ?? "{}");
  } finally {
    await client.files.delete(uploadedFile.id).catch((e: unknown) => console.warn("[proposalExtractor] File cleanup failed:", e));
  }
}

export async function extractProposalFromDocx(docxBytes: Uint8Array): Promise<ExtractedProposalFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(docxBytes);
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: `${PROPOSAL_EXTRACT_PROMPT}\n\nDOCUMENT TEXT:\n${rawText.slice(0, 8000)}` }],
  });
  return parseResponse(response.choices[0]?.message?.content ?? "{}");
}

export async function extractProposalFromText(text: string): Promise<ExtractedProposalFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: `${PROPOSAL_EXTRACT_PROMPT}\n\nDOCUMENT TEXT:\n${text.slice(0, 8000)}` }],
  });
  return parseResponse(response.choices[0]?.message?.content ?? "{}");
}

export function hasAnyProposalField(fields: ExtractedProposalFields | null): boolean {
  if (!fields) return false;
  return !!(fields.clientName || fields.projectName || fields.estimatedAmount);
}
