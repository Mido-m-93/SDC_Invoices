// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pipelineExtraction.ts — pipeline record extraction
//
// Turns freeform text (a Notion page body) into structured pipeline items.
// Uses OpenAI (OPENAI_API_KEY is already configured in this project), same
// JSON-extraction pattern as contractExtractor.ts's docx path.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import OpenAI from "openai";

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

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
- For estimatedAmount: look hard — check for any monetary value, budget, fee, contract amount, or price mentioned near the client/deal (e.g. "¥500,000", "$10,000", "500K", "monthly fee: 200,000"). Strip currency symbols and parse as a plain number. Only return null if truly no amount appears anywhere in the entry.
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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — required for pipeline extraction");
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
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
// each client's own WorkTogether folder — deliberately NOT routed through
// pdfExtractor.ts's pdfjs-dist text extraction. That module can crash at
// import time in this serverless runtime ("DOMMatrix is not defined" — see
// contractExtractor.ts's header comment for the same reasoning), so PDFs use
// OpenAI's native file understanding instead, same pattern as
// extractProposalFromPdf in proposalExtractor.ts.
export async function extractPipelineRecordsFromPdf(pdfBytes: Uint8Array): Promise<ExtractedPipelineItem[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — required for pipeline extraction");
  }
  const client = getClient();
  const plainBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  const fileBlob = new File([plainBuffer], "pipeline-doc.pdf", { type: "application/pdf" });
  const uploadedFile = await client.files.create({ file: fileBlob, purpose: "user_data" });
  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [{
        role: "user",
        content: [
          { type: "input_file", file_id: uploadedFile.id },
          { type: "input_text", text: `${PIPELINE_EXTRACT_PROMPT_HEADER}\n\n${PIPELINE_EXTRACT_PROMPT_SHAPE}` },
        ],
      }],
      max_output_tokens: 2048,
    });
    return parseItemsResponse(response.output_text ?? "[]");
  } finally {
    await client.files.delete(uploadedFile.id).catch((e: unknown) => console.warn("[pipelineExtraction] File cleanup failed:", e));
  }
}
