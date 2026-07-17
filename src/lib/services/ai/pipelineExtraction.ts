// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pipelineExtraction.ts — pipeline record extraction
//
// Turns freeform text (a Notion page body) into structured pipeline items.
// Uses Claude (ANTHROPIC_API_KEY is already configured in this project),
// same JSON-extraction pattern as SupabaseExpenseService's receipt extraction.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import Anthropic from "@anthropic-ai/sdk";

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

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — required for pipeline extraction");
  }

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `The text below is a freeform Notion page tracking a sales/client pipeline (leads, proposals, deals). Extract every distinct deal/client entry you can find and return ONLY a valid JSON array — no markdown, no explanation.

${rawText.slice(0, 12000)}

Return exactly this JSON shape (array):
[
  {
    "rawClientName": "client or company name exactly as written",
    "projectName": "deal/project title or short description",
    "stageOrStatus": "whatever stage/status label is used in the text (e.g. 'new', 'in talks', 'proposal sent', 'won')",
    "estimatedAmount": number or null,
    "currency": "JPY, USD, etc — guess JPY if unclear",
    "contactName": "contact person name or null",
    "contactEmail": "contact email or null",
    "notes": "any other relevant free text or null"
  }
]

Rules:
- One object per distinct client/deal mentioned.
- rawClientName is required; skip entries where no client/company name can be identified.
- Do not invent data that is not present in the text.`,
      },
    ],
  });

  const text = (response.content[0] as { type: string; text?: string }).text?.trim() ?? "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map(coerceItem)
      .filter((item): item is ExtractedPipelineItem => item !== null);
  } catch (err) {
    console.warn("[pipelineExtraction] Failed to parse Claude response:", err);
    return [];
  }
}
