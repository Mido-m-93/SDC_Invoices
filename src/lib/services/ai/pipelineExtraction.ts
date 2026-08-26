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

Return exactly this JSON shape (array):
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
- rawClientName is required; skip entries with no identifiable client/company.
- For estimatedAmount: look hard — check for any monetary value, budget, fee, contract amount, or price mentioned near the client/deal (e.g. "¥500,000", "$10,000", "500K", "monthly fee: 200,000"). Strip currency symbols and parse as a plain number. Only return null if truly no amount appears anywhere in the entry.
- Do not invent data not present in the text.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "[]";
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
