// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/consistencyVerifier.ts — pipeline stage-transition verification
//
// Shared AI check used at three pipeline checkpoints (Proposal↔Lead,
// Contract↔Proposal, Invoice↔Contract): given two records that are supposed
// to describe the same deal, flag anything that doesn't line up (amount,
// client, dates, scope) instead of assuming the later stage always matches
// the earlier one. Same GPT JSON-extraction pattern as pipelineExtraction.ts.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import OpenAI from "openai";
import type { ConsistencyVerdict } from "@/types";

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Compare two related pipeline records (e.g. a Proposal and the Lead it came
 * from) and flag inconsistencies — mismatched amounts, client names, dates,
 * or scope. Never blocks by itself; callers decide what to do with a
 * `consistent: false` verdict.
 */
export async function verifyConsistency(
  labelA: string,
  recordA: unknown,
  labelB: string,
  recordB: unknown,
): Promise<ConsistencyVerdict> {
  const checkedAt = new Date().toISOString();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — required for consistency verification");
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Compare these two related business records from the same sales pipeline and check whether they are CONSISTENT with each other (same client, similar amount, compatible dates/scope). They don't need to be identical — later stages naturally add detail — but flag anything that looks contradictory or mismatched, not just "missing".

${labelA.toUpperCase()}:
${JSON.stringify(recordA, null, 2)}

${labelB.toUpperCase()}:
${JSON.stringify(recordB, null, 2)}

Return ONLY valid JSON, no markdown, no explanation, in exactly this shape:
{
  "consistent": true or false,
  "discrepancies": ["short human-readable description of each mismatch — empty array if none"],
  "confidence": number between 0 and 1
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { consistent: true, discrepancies: [], confidence: 0, checkedAt };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ConsistencyVerdict>;
    return {
      consistent: typeof parsed.consistent === "boolean" ? parsed.consistent : true,
      discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies.filter((d): d is string => typeof d === "string") : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      checkedAt,
    };
  } catch (err) {
    console.warn("[consistencyVerifier] Failed to parse GPT response:", err);
    return { consistent: true, discrepancies: [], confidence: 0, checkedAt };
  }
}
