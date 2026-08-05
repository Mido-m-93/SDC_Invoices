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

function getConfig(): { token: string; databaseId: string } {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_PIPELINE_DATABASE_ID;
  if (!token) throw new Error("NOTION_TOKEN is not set");
  if (!databaseId) throw new Error("NOTION_PIPELINE_DATABASE_ID is not set");
  return { token, databaseId };
}

async function queryDatabase(token: string, databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
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

export interface NotionSourceScanDetail {
  pagesFound: number;
  batches: number;
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
  const batches = batchPageTexts(pages.map(pageToTextBlock));

  const items: ExtractedPipelineItem[] = [];
  for (const batch of batches) {
    const extracted = await extractPipelineRecordsFromText(batch).catch((err) => {
      console.warn("[pipelineNotionSource] Extraction failed for a batch:", err);
      return [];
    });
    items.push(...extracted);
  }

  return { items, scan: { pagesFound: pages.length, batches: batches.length } };
}
