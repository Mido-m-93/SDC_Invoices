import "server-only";
import OpenAI from "openai";

export interface ExtractedBudgetFields {
  clientName: string | null;
  projectName: string | null;
  budgetAmount: number | null;
  currency: string;
  budgetDate: string | null;
}

const BUDGET_EXTRACT_PROMPT = `Extract budget/cost-plan fields from this document and return ONLY valid JSON — no markdown, no explanation.

Return exactly this JSON:
{
  "clientName": "client or company name this budget is for, or null",
  "projectName": "project or service title, or null",
  "budgetAmount": number or null,
  "currency": "JPY, USD, etc — default JPY if unclear",
  "budgetDate": "YYYY-MM-DD or null"
}

Rules:
- clientName: the client / customer this budget plan is for
- budgetAmount: search the ENTIRE document, not just text near the client/title — a total or planned cost is often stated elsewhere (a summary line, a cost breakdown table, a signature block). Look for both English cues (budget, cost, amount, total, planned spend) and Japanese cues (予算, 予算額, 金額, 合計, 費用, 計画金額). Only return null if truly no monetary figure appears anywhere in the document.
- budgetAmount must be a plain number with no currency symbols or commas
- currency: infer from ¥/￥/円 → JPY, $ → USD; default JPY
- budgetDate: the document date or planning date
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

function parseResponse(text: string): ExtractedBudgetFields {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    return { clientName: null, projectName: null, budgetAmount: null, currency: "JPY", budgetDate: null };
  }
  return {
    clientName: typeof parsed.clientName === "string" ? parsed.clientName : null,
    projectName: typeof parsed.projectName === "string" ? parsed.projectName : null,
    budgetAmount: parseNumericField(parsed.budgetAmount),
    currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : "JPY",
    budgetDate: typeof parsed.budgetDate === "string" ? parsed.budgetDate : null,
  };
}

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export async function extractBudgetFromPdf(pdfBytes: Uint8Array): Promise<ExtractedBudgetFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const client = getClient();
  const plainBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  const fileBlob = new File([plainBuffer], "budget.pdf", { type: "application/pdf" });
  const uploadedFile = await client.files.create({ file: fileBlob, purpose: "user_data" });
  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: [{ type: "input_file", file_id: uploadedFile.id }, { type: "input_text", text: BUDGET_EXTRACT_PROMPT }] }],
      max_output_tokens: 512,
    });
    return parseResponse(response.output_text ?? "{}");
  } finally {
    await client.files.delete(uploadedFile.id).catch((e: unknown) => console.warn("[budgetExtractor] File cleanup failed:", e));
  }
}

export async function extractBudgetFromDocx(docxBytes: Uint8Array): Promise<ExtractedBudgetFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(docxBytes);
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: `${BUDGET_EXTRACT_PROMPT}\n\nDOCUMENT TEXT:\n${rawText.slice(0, 8000)}` }],
  });
  return parseResponse(response.choices[0]?.message?.content ?? "{}");
}

export async function extractBudgetFromText(text: string): Promise<ExtractedBudgetFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: `${BUDGET_EXTRACT_PROMPT}\n\nDOCUMENT TEXT:\n${text.slice(0, 8000)}` }],
  });
  return parseResponse(response.choices[0]?.message?.content ?? "{}");
}

export function hasAnyBudgetField(fields: ExtractedBudgetFields | null): boolean {
  if (!fields) return false;
  return !!(fields.clientName || fields.projectName || fields.budgetAmount);
}
