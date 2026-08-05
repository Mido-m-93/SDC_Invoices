// src/lib/services/real/pipelineNotionSource.ts
// Real Notion source for Pipeline Sync — replaces the fixture page text in
// lib/services/mock/pipelineSources.ts once NOTION_TOKEN and
// NOTION_PIPELINE_DATABASE_ID are configured.
//
// The database's exact property schema isn't hardcoded here — every page's
// properties are serialized to a text block (same "## title\n- Prop: value"
// shape as the mock Notion page) and run through the same
// extractPipelineRecordsFromText() already used for the mock Notion source
// and the real SharePoint source. This avoids brittle per-column mapping and
// only needs the extraction prompt tuned, not a code change, if the
// database's property layout changes. Read-only: never writes to Notion.

import "server-only";
import { extractPipelineRecordsFromText, type ExtractedPipelineItem } from "../ai/pipelineExtraction";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // safety cap against runaway pagination
// Kept comfortably under extractPipelineRecordsFromText's internal 12000-char
// slice so a large database doesn't silently lose later pages to truncation.
const MAX_CHARS_PER_BATCH = 10000;

interface NotionPropertyValue {
  type: string;
  [key: string]: unknown;
}

interface NotionPage {
  id: string;
  properties: Record<string, NotionPropertyValue>;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// A valid Notion object ID is 32 hex chars, optionally hyphenated as a UUID.
const NOTION_ID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function getConfig(): { token: string; databaseId: string } {
  // .trim() guards against the single most common cause of Notion's
  // "invalid_request_url" — a trailing space/newline picked up when the
  // token or ID was pasted into the env var value.
  const token = process.env.NOTION_TOKEN?.trim();
  const databaseId = process.env.NOTION_PIPELINE_DATABASE_ID?.trim();
  if (!token) throw new Error("NOTION_TOKEN is not set");
  if (!databaseId) throw new Error("NOTION_PIPELINE_DATABASE_ID is not set");
  if (!NOTION_ID_PATTERN.test(databaseId)) {
    throw new Error(
      `NOTION_PIPELINE_DATABASE_ID does not look like a valid Notion ID (got ${databaseId.length} chars, expected 32 hex chars optionally hyphenated) — re-copy it from the database's URL, the segment right after the workspace name and before "?v="`
    );
  }
  return { token, databaseId };
}

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// Notion-Version 2025-09-03 restructured databases around "data sources" —
// a database no longer owns pages directly, and POST /databases/{id}/query
// returns 400 invalid_request_url under this version. Resolve the database's
// first data_source_id via GET /databases/{id}, then query that instead.
async function resolveDataSourceId(token: string, databaseId: string): Promise<string | null> {
  const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
    method: "GET",
    headers: notionHeaders(token),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GET /databases/${databaseId} → ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { data_sources?: Array<{ id: string }> };
  return data.data_sources?.[0]?.id ?? null;
}

async function queryPaginated(token: string, url: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const res = await fetch(url, {
      method: "POST",
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: PAGE_SIZE, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Notion API ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as NotionQueryResponse;
    pages.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor && pages.length < MAX_PAGES);

  return pages;
}

async function queryDatabase(token: string, databaseId: string): Promise<NotionPage[]> {
  const dataSourceId = await resolveDataSourceId(token, databaseId);
  if (dataSourceId) {
    return queryPaginated(token, `${NOTION_API}/data_sources/${dataSourceId}/query`);
  }
  // Only reached for a pre-2025-09 style database with no data_sources array —
  // the legacy endpoint is genuinely correct in that case, not a blind guess.
  return queryPaginated(token, `${NOTION_API}/databases/${databaseId}/query`);
}

// Renders one Notion property value to a plain-text string, or null if empty/unsupported.
function renderPropertyValue(prop: NotionPropertyValue): string | null {
  switch (prop.type) {
    case "title":
    case "rich_text": {
      const arr = (prop[prop.type] as Array<{ plain_text?: string }>) ?? [];
      const text = arr.map((t) => t.plain_text ?? "").join("").trim();
      return text || null;
    }
    case "number":
      return typeof prop.number === "number" ? String(prop.number) : null;
    case "select":
      return (prop.select as { name?: string } | null)?.name ?? null;
    case "status":
      return (prop.status as { name?: string } | null)?.name ?? null;
    case "multi_select": {
      const arr = (prop.multi_select as Array<{ name: string }>) ?? [];
      return arr.length ? arr.map((o) => o.name).join(", ") : null;
    }
    case "date": {
      const d = prop.date as { start?: string; end?: string } | null;
      if (!d?.start) return null;
      return d.end ? `${d.start} – ${d.end}` : d.start;
    }
    case "email":
      return (prop.email as string | null) ?? null;
    case "phone_number":
      return (prop.phone_number as string | null) ?? null;
    case "url":
      return (prop.url as string | null) ?? null;
    case "checkbox":
      return prop.checkbox ? "yes" : null;
    case "people": {
      const arr = (prop.people as Array<{ name?: string }>) ?? [];
      const names = arr.map((p) => p.name).filter((n): n is string => Boolean(n));
      return names.length ? names.join(", ") : null;
    }
    case "formula": {
      const f = prop.formula as { type: string; [k: string]: unknown } | undefined;
      if (!f) return null;
      if (f.type === "string") return (f.string as string | null) ?? null;
      if (f.type === "number") return typeof f.number === "number" ? String(f.number) : null;
      return null;
    }
    default:
      return null; // relation/rollup/files/created_by/etc. — not useful as plain text
  }
}

function findTitle(properties: Record<string, NotionPropertyValue>): string {
  for (const prop of Object.values(properties)) {
    if (prop.type === "title") return renderPropertyValue(prop) ?? "Untitled";
  }
  return "Untitled";
}

function pageToTextBlock(page: NotionPage): string {
  const lines: string[] = [`## ${findTitle(page.properties)}`];
  for (const [name, prop] of Object.entries(page.properties)) {
    if (prop.type === "title") continue; // already used as the heading
    const value = renderPropertyValue(prop);
    if (value) lines.push(`- ${name}: ${value}`);
  }
  return lines.join("\n");
}

// Groups page text blocks into batches that each stay under MAX_CHARS_PER_BATCH,
// so no batch gets silently truncated by the extraction call's own char limit.
function batchPageTexts(blocks: string[]): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const block of blocks) {
    if (currentLen > 0 && currentLen + block.length + 2 > MAX_CHARS_PER_BATCH) {
      batches.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += block.length + 2;
  }
  if (current.length) batches.push(current.join("\n\n"));
  return batches;
}

// Each batch is one sequential-looking OpenAI call from this function's point
// of view, but running them in parallel (not a for-loop) keeps total wall-clock
// close to a single call's latency instead of summing every batch — needed to
// stay comfortably under the API route's maxDuration regardless of database size.
// A hard cap on top of that guards the case where even parallel calls would
// blow past the timeout (e.g. a very large database, or OpenAI running slow).
// NOTE: queryDatabase() always fetches every page fresh each run and batches
// them in the same order, so if the cap is ever hit, the SAME trailing batches
// are skipped on every subsequent run too — this is not a rotating/resumable
// cap. The skip is surfaced loudly in the audit log rather than silently
// dropped; raise this constant if the real database grows past what it covers.
const MAX_BATCHES_PER_RUN = 8;

export interface NotionSourceScanDetail {
  pagesFound: number;
  batches: number;
  skippedBatches: number;
}

/**
 * Query the configured Notion pipeline database, serialize every page's
 * properties to text (schema-agnostic — same approach as the SharePoint real
 * source), and run each batch through the same AI extraction used for the
 * mock Notion source. Never writes anything back to Notion.
 */
export async function fetchRealNotionPipelineItems(): Promise<{
  items: ExtractedPipelineItem[];
  scan: NotionSourceScanDetail;
}> {
  const { token, databaseId } = getConfig();
  const pages = await queryDatabase(token, databaseId);
  const allBatches = batchPageTexts(pages.map(pageToTextBlock));
  const batches = allBatches.slice(0, MAX_BATCHES_PER_RUN);
  const skippedBatches = allBatches.length - batches.length;

  const results = await Promise.all(
    batches.map((batch) =>
      extractPipelineRecordsFromText(batch).catch((err) => {
        console.warn("[pipelineNotionSource] Extraction failed for a batch:", err);
        return [];
      })
    )
  );
  const items = results.flat();

  return { items, scan: { pagesFound: pages.length, batches: batches.length, skippedBatches } };
}
