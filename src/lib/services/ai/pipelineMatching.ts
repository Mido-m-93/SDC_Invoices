// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pipelineMatching.ts — fuzzy client entity matching
//
// Scores a raw client-name string (from Notion/SharePoint pipeline sources)
// against the existing client master, using normalized token overlap plus
// exact alias matches. Same shape of problem as vendor matching in
// matchingService.ts, but for clients and without a PDF in the loop.
// ─────────────────────────────────────────────────────────────────────────────

import type { Client, PipelineMatchCandidate } from "@/types";

const STOPWORDS = new Set([
  "inc", "inc.", "corp", "corp.", "co", "co.", "ltd", "ltd.", "llc", "kk",
  "k.k.", "kabushiki", "kaisha", "gmbh", "the", "company", "株式会社", "有限会社",
]);

function normalizeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,、。()（）]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function normalizeExact(name: string): string {
  return normalizeTokens(name).join(" ");
}

// Jaccard similarity over normalized token sets, plus a bonus for exact
// substring containment (handles "Acme" vs "Acme Japan K.K.").
function similarity(a: string, b: string): number {
  const tokensA = new Set(normalizeTokens(a));
  const tokensB = new Set(normalizeTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const normA = normalizeExact(a);
  const normB = normalizeExact(b);
  if (normA === normB) return 1;

  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = intersection / union;

  const substringBonus =
    normA.length > 0 && normB.length > 0 && (normA.includes(normB) || normB.includes(normA))
      ? 0.25
      : 0;

  return Math.min(1, jaccard + substringBonus);
}

/**
 * Rank existing clients by how well their name (or any known alias) matches
 * a raw, free-text client name extracted from a pipeline source.
 * Returns candidates sorted by score descending, best first.
 */
export function rankClientCandidates(
  rawName: string,
  clients: Client[],
  limit = 5
): PipelineMatchCandidate[] {
  if (!rawName.trim()) return [];

  const scored = clients.map((client) => {
    const nameScore = similarity(rawName, client.name);
    const aliasScore = (client.aliases ?? []).reduce(
      (best, alias) => Math.max(best, similarity(rawName, alias)),
      0
    );
    return {
      clientId: client.id,
      clientName: client.name,
      score: Math.max(nameScore, aliasScore),
    };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Confidence threshold above which a match auto-links without human review.
export const AUTO_LINK_THRESHOLD = 0.85;
