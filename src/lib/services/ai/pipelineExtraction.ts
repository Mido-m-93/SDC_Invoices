// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pipelineExtraction.ts — pipeline record extraction
//
// Turns freeform text (a Notion page body) into structured pipeline items.
// Groq only (no OpenAI) — same pattern as contractExtractor.ts's docx path.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import Groq from "groq-sdk";

export interface ExtractedPipelineItem {
  rawClientName: string;
  projectName: string;
  stageOrStatus: string;
  estimatedAmount: number | null;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
}

let _client: Groq | undefined;
function getClient(): Groq {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

const PIPELINE_EXTRACT_PROMPT_HEADER = `The attached document is a client/deal document from a sales pipeline (a proposal, deal sheet, or similar). Extract every distinct deal/client entry it describes and return ONLY a valid JSON array — no markdown, no explanation.`;

const PIPELINE_EXTRACT_PROMPT_SHAPE = `Return exactly this JSON shape (array):
[
  {
    "rawClientName": "client or company name exactly as written",
    "projectName": "deal/project title or short description",
    "stageOrStatus": "whatever stage/status label is used (e.g. 'new', 'in talks', 'proposal sent', 'won')",
    "estimatedAmount": number or null,
    "currency": "JPY, USD, etc — default JPY if unclear",
    "contactName": "contact person name or null",
    "contactEmail": "contact email or null",
    "notes": "any other relevant free text or null"
  }
]

Rules:
- One object per distinct client/deal.
- rawClientName MUST be an actual external client/company/organization name — the counterparty this deal is with. Look specifically for a field or label like "Client", "Company", "Customer", "顧客", "会社名", "クライアント", "取引先", or the recipient/addressee of a proposal.
- Do NOT use a page title, deal title, or project/initiative name as rawClientName just because no clearer field exists (e.g. titles like "Finance & Sales Automation", "PowerAutomate", "POS", "Digital Transformation" are project/tool names, not clients — internal automation projects and case-study/tool names are not clients either). If you cannot find an actual company/organization name distinct from the deal title, skip the entry entirely rather than guessing.
- projectName is the deal/project title (this is where "PowerAutomate"-style names belong, not rawClientName).
- For estimatedAmount: search the ENTIRE document/entry, not just text immediately next to the client name — a total or fee is often stated elsewhere (a summary line, a table, a signature block). Look for both English cues (e.g. "¥500,000", "$10,000", "500K", "monthly fee: 200,000", "budget", "total", "fee", "quote") and Japanese cues (見積, 見積金額, 金額, 合計, 月額, 予算, 費用, 契約金額). Strip currency symbols/commas and parse as a plain number. Only return null if truly no monetary figure appears anywhere in the document.
- Do not invent data not present in the document.`;

function parseItemsResponse(text: string): ExtractedPipelineItem[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map(coerceItem)
      .filter((item): item is ExtractedPipelineItem => item !== null);
  } catch (err) {
    console.warn("[pipelineExtraction] Failed to parse GPT response:", err);
    return [];
  }
}

function coerceItem(raw: Record<string, unknown>): ExtractedPipelineItem | null {
  const rawClientName = typeof raw.rawClientName === "string" ? raw.rawClientName.trim() : "";
  if (!rawClientName) return null;
  return {
    rawClientName,
    projectName: typeof raw.projectName === "string" ? raw.projectName : "",
    stageOrStatus: typeof raw.stageOrStatus === "string" ? raw.stageOrStatus : "unknown",
    estimatedAmount: typeof raw.estimatedAmount === "number" ? raw.estimatedAmount : null,
    currency: typeof raw.currency === "string" && raw.currency ? raw.currency : "JPY",
    contactName: typeof raw.contactName === "string" ? raw.contactName : null,
    contactEmail: typeof raw.contactEmail === "string" ? raw.contactEmail : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

/**
 * Extract structured pipeline records (client/project/stage/amount) from a
 * freeform text page — e.g. a Notion page body with no structured properties.
 */
export async function extractPipelineRecordsFromText(
  rawText: string
): Promise<ExtractedPipelineItem[]> {
  if (!rawText.trim()) return [];

  const response = await getClient().chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `The text below is a freeform Notion page or SharePoint file tracking a sales/client pipeline (leads, proposals, deals). Extract every distinct deal/client entry and return ONLY a valid JSON array — no markdown, no explanation.

${rawText.slice(0, 12000)}

${PIPELINE_EXTRACT_PROMPT_SHAPE}`,
      },
    ],
  });

  return parseItemsResponse(response.choices[0]?.message?.content?.trim() ?? "[]");
}

// PDF client/deal documents (proposals, deal sheets) found while scanning
// each client's own WorkTogether folder. Text extracted locally via unpdf,
// then parsed the same way as the freeform-text path above — no vision
// fallback, so a scanned (image-only) PDF yields no records.
export async function extractPipelineRecordsFromPdf(pdfBytes: Uint8Array): Promise<ExtractedPipelineItem[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: true });
  if (!text.trim()) return [];

  const response = await getClient().chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `${PIPELINE_EXTRACT_PROMPT_HEADER}\n\n${text.slice(0, 12000)}\n\n${PIPELINE_EXTRACT_PROMPT_SHAPE}`,
    }],
  });
  return parseItemsResponse(response.choices[0]?.message?.content?.trim() ?? "[]");
}
