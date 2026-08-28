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

// Character bigrams over the token-joined string with spaces stripped.
// Whitespace-token Jaccard alone is nearly useless for CJK names — Japanese
// text has no spaces, so e.g. "島根県" collapses into a single token and can
// only ever score 0 or 1 against another single-token string. Bigrams give
// partial credit for shared substrings regardless of script, the same way
// word-token Jaccard does for space-delimited languages.
function charBigrams(compact: string): Set<string> {
  if (compact.length < 2) return compact.length === 1 ? new Set([compact]) : new Set();
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) grams.add(compact.slice(i, i + 2));
  return grams;
}

function bigramJaccard(a: string, b: string): number {
  const bigramsA = charBigrams(a.replace(/\s+/g, ""));
  const bigramsB = charBigrams(b.replace(/\s+/g, ""));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const g of bigramsA) if (bigramsB.has(g)) intersection++;
  const union = new Set([...bigramsA, ...bigramsB]).size;
  return intersection / union;
}

// Best of: word-token Jaccard (handles space-delimited names, e.g. "Acme"
// vs "Acme Japan K.K."), a containment bonus scaled by how much of the
// longer string the shorter one covers, and character-bigram Jaccard
// (carries CJK and other non-space-delimited names, where the token
// approach degenerates to one token per string).
// Exported so other name-matching call sites (e.g. contract sync) share this
// scorer instead of hand-rolling their own fuzzy matcher.
export function similarity(a: string, b: string): number {
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

  const isContained = normA.length > 0 && normB.length > 0 && (normA.includes(normB) || normB.includes(normA));
  const containmentScore = isContained
    ? (() => {
        const shorterLen = Math.min(normA.length, normB.length);
        const longerLen = Math.max(normA.length, normB.length);
        const coverage = shorterLen / longerLen;
        return 0.5 + 0.45 * coverage; // full containment -> 0.95, a sliver -> ~0.5
      })()
    : 0;

  const bigramScore = bigramJaccard(normA, normB);

  return Math.min(1, Math.max(jaccard, containmentScore, bigramScore));
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
