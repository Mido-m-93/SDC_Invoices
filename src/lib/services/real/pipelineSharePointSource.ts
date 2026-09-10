// src/lib/services/real/pipelineSharePointSource.ts
// Real SharePoint source for Pipeline Sync — replaces the fixture data in
// lib/services/mock/pipelineSources.ts once Azure creds are configured.
//
// The real pipeline tracker's exact column layout isn't confirmed yet (see
// docs/PIPELINE_ARCHITECTURE.md — confirm via
// GET /api/debug/sharepoint-folder?which=pipeline before relying on this in
// production). Rather than hardcode column names that might be wrong, every
// file found is serialized to text and run through the same Claude-based
// extractPipelineRecordsFromText() already used for the Notion source — this
// works regardless of the tracker's exact schema and only needs adjusting if
// the extraction prompt needs tuning, not a code change per column.
//
// Scoped to only this dedicated pipeline tracker folder — client
// WorkTogether folders (03_Project/04_Partner) are not scanned here; that
// data belongs to Proposals sync instead (see proposalSharePointSource.ts).

import "server-only";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  downloadFileById,
  type GraphDriveItem,
} from "./graphClient";
import { extractPipelineRecordsFromText, extractPipelineRecordsFromPdf, type ExtractedPipelineItem } from "../ai/pipelineExtraction";

// Scope the crawl explicitly — an unbounded recursive scan of the whole
// SharePoint site would be slow, expensive (AI extraction per file), and
// noisy. Add more paths via env as folders are confirmed relevant.
const PIPELINE_FOLDER_PATHS = (process.env.MICROSOFT_PIPELINE_FOLDER_PATH
  ?? "30_WorkTogether/02_Pipeline/10_Pipeline")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function fileToText(siteId: string, token: string, item: GraphDriveItem): Promise<string | null> {
  const lower = item.name.toLowerCase();
  try {
    const bytes = await downloadFileById(siteId, item.id, token);
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const { read, utils } = await import("xlsx");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wb = read(Buffer.from(bytes), { cellDates: true } as any);
      return wb.SheetNames
        .map((name) => `Sheet: ${name}\n${utils.sheet_to_csv(wb.Sheets[name])}`)
        .join("\n\n");
    }
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      return Buffer.from(bytes).toString("utf-8");
    }
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value || null;
    }
    return null; // pdf handled separately (extractItemsFromFile) — everything else unsupported
  } catch (err) {
    console.warn(`[pipelineSharePointSource] Failed to read "${item.name}":`, err);
    return null;
  }
}

// PDFs go straight to OpenAI's native file understanding (extractItemsFromFile
// below), bypassing the text step entirely — see extractPipelineRecordsFromPdf's
// header comment for why pdfjs-dist-based text extraction is avoided here.
async function extractItemsFromFile(siteId: string, token: string, item: GraphDriveItem): Promise<ExtractedPipelineItem[] | null> {
  const lower = item.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    try {
      const bytes = await downloadFileById(siteId, item.id, token);
      return await extractPipelineRecordsFromPdf(bytes);
    } catch (err) {
      console.warn(`[pipelineSharePointSource] PDF extraction failed for "${item.name}":`, err);
      return [];
    }
  }
  const text = await fileToText(siteId, token, item);
  if (!text) return null; // unsupported type
  return extractPipelineRecordsFromText(text).catch((err) => {
    console.warn(`[pipelineSharePointSource] Extraction failed for "${item.name}":`, err);
    return [];
  });
}

export interface PipelineSourceScanDetail {
  folder: string;
  file: string;
  extracted: number;
  skipped?: string;
}

// Runs `fn` over `items` with at most `limit` in flight — the category
// folders each hold many per-client subfolders (confirmed via a real scan:
// 10_Pipeline/01_企業 alone had a dozen+ client folders), so walking them
// one at a time would be slow across a whole tree of categories.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Real structure turned out to be 10_Pipeline/<category>/<client>/<files> —
// one level deeper than originally assumed. Rather than hardcode that exact
// depth (a client folder could itself have a project subfolder in some
// cases), this walks the whole subtree under each category folder, capped
// at MAX_DEPTH as a safety valve against an unexpectedly deep or cyclical
// structure — 10_Pipeline itself is scoped separately via PIPELINE_FOLDER_PATHS,
// so this never risks crawling the wider site.
const MAX_DEPTH = 6;

async function walkFolder(
  siteId: string,
  token: string,
  folderId: string,
  folderLabel: string,
  depth: number,
  files: GraphDriveItem[],
  scan: PipelineSourceScanDetail[]
): Promise<void> {
  if (depth > MAX_DEPTH) {
    scan.push({ folder: folderLabel, file: "(folder)", extracted: 0, skipped: `max recursion depth (${MAX_DEPTH}) reached` });
    return;
  }
  let children: GraphDriveItem[];
  try {
    children = await listItemsByFolderId(siteId, folderId, token);
  } catch (err) {
    scan.push({ folder: folderLabel, file: "(folder)", extracted: 0, skipped: `subfolder read failed: ${String(err)}` });
    return;
  }
  const subFiles = children.filter((c) => !c.isFolder);
  const subFolders = children.filter((c) => c.isFolder);
  // Log every folder's result, even "found nothing" — without this, an
  // empty or inaccessible subfolder leaves no trace in scan, making it
  // impossible to tell "Graph saw 0 items here" apart from "this folder
  // was never reached" when diagnosing a sync that finds fewer files than
  // the tree actually contains.
  scan.push({
    folder: folderLabel,
    file: "(folder)",
    extracted: 0,
    skipped: `listed: ${children.length} item(s) — ${subFiles.length} file(s), ${subFolders.length} subfolder(s)`,
  });
  files.push(...subFiles);
  await mapWithConcurrency(subFolders, 6, (sub) =>
    walkFolder(siteId, token, sub.id, `${folderLabel}/${sub.name}`, depth + 1, files, scan)
  );
}

/**
 * Scan the configured pipeline folder(s), extract structured deal records
 * from every readable file via Claude, and return them all flattened.
 * Never writes anything — purely a read + extract pass; staging/matching
 * happens downstream in pipelineSyncService.ts exactly as it does for Notion.
 */
export async function fetchRealSharePointPipelineItems(): Promise<{
  items: ExtractedPipelineItem[];
  scan: PipelineSourceScanDetail[];
}> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const items: ExtractedPipelineItem[] = [];
  const scan: PipelineSourceScanDetail[] = [];

  for (const folderPath of PIPELINE_FOLDER_PATHS) {
    let topLevel: GraphDriveItem[];
    try {
      topLevel = await listFolderChildren(siteId, folderPath, token);
    } catch (err) {
      scan.push({ folder: folderPath, file: "(folder)", extracted: 0, skipped: `folder not accessible: ${String(err)}` });
      continue;
    }

    const files: GraphDriveItem[] = topLevel.filter((e) => !e.isFolder);
    const subfolders = topLevel.filter((e) => e.isFolder);
    await mapWithConcurrency(subfolders, 6, (entry) =>
      walkFolder(siteId, token, entry.id, `${folderPath}/${entry.name}`, 1, files, scan)
    );

    // Extraction is AI-per-file and now runs across every client folder in
    // every category — sequential would risk the route's 300s budget once
    // this actually finds the real file tree, so bound concurrency instead
    // (same rationale as proposalSharePointSource.ts's extraction pass).
    await mapWithConcurrency(files, 4, async (file) => {
      const extracted = await extractItemsFromFile(siteId, token, file);
      if (extracted === null) {
        scan.push({ folder: folderPath, file: file.name, extracted: 0, skipped: "unsupported file type" });
        return;
      }
      items.push(...extracted);
      scan.push({ folder: folderPath, file: file.name, extracted: extracted.length });
    });
  }

  return { items, scan };
}
