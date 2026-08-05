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
// Per-batch deadline so one slow/rate-limited OpenAI call can't block the
// whole invocation past the API route's maxDuration (60s) — leaves headroom
// for the Notion query + audit logging + response overhead around it.
const PER_BATCH_TIMEOUT_MS = 40_000;
const TIMED_OUT = Symbol("pipeline-batch-timed-out");
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

// Races a promise against a fixed deadline. On timeout, resolves to the
// TIMED_OUT sentinel instead of rejecting — the underlying call is NOT
// cancelled (fetch/OpenAI SDK calls aren't abortable here), it just stops
// being waited on so one slow batch can't block every other batch's result.
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), ms)),
  ]);
}

export interface NotionSourceScanDetail {
  pagesFound: number;
  batches: number;
  timedOutBatches: number;
}

/**
 * Query the configured Notion pipeline database, serialize every page's
 * properties to text (schema-agnostic — same approach as the SharePoint real
 * source), and run every batch through the same AI extraction used for the
 * mock Notion source, all concurrently — total wall-clock stays close to one
 * batch's latency (bounded by PER_BATCH_TIMEOUT_MS) rather than summing every
 * batch, regardless of database size. No batch is positionally skipped —
 * every page gets a genuine attempt on every run. Never writes to Notion.
 */
export async function fetchRealNotionPipelineItems(): Promise<{
  items: ExtractedPipelineItem[];
  scan: NotionSourceScanDetail;
}> {
  const { token, databaseId } = getConfig();
  const pages = await queryDatabase(token, databaseId);
  const batches = batchPageTexts(pages.map(pageToTextBlock));

  const settled = await Promise.all(
    batches.map((batch) =>
      withTimeout(
        extractPipelineRecordsFromText(batch).catch((err) => {
          console.warn("[pipelineNotionSource] Extraction failed for a batch:", err);
          return [] as ExtractedPipelineItem[];
        }),
        PER_BATCH_TIMEOUT_MS
      )
    )
  );
  const timedOutBatches = settled.filter((r) => r === TIMED_OUT).length;
  const items = settled.flatMap((r) => (r === TIMED_OUT ? [] : r));

  return { items, scan: { pagesFound: pages.length, batches: batches.length, timedOutBatches } };
}
