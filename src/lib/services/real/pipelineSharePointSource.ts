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
import { extractPipelineRecordsFromText, type ExtractedPipelineItem } from "../ai/pipelineExtraction";

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
    return null; // unsupported type (docx/pdf/etc.) — skip rather than guess-parse
  } catch (err) {
    console.warn(`[pipelineSharePointSource] Failed to read "${item.name}":`, err);
    return null;
  }
}

export interface PipelineSourceScanDetail {
  folder: string;
  file: string;
  extracted: number;
  skipped?: string;
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

    // One level of recursion into subfolders (deal-per-folder layouts), same depth
    // as the debug inspector and the member-contract sync.
    const files: GraphDriveItem[] = [];
    for (const entry of topLevel) {
      if (!entry.isFolder) { files.push(entry); continue; }
      try {
        const children = await listItemsByFolderId(siteId, entry.id, token);
        files.push(...children.filter((c) => !c.isFolder));
      } catch (err) {
        scan.push({ folder: folderPath, file: entry.name, extracted: 0, skipped: `subfolder read failed: ${String(err)}` });
      }
    }

    for (const file of files) {
      const text = await fileToText(siteId, token, file);
      if (!text) {
        scan.push({ folder: folderPath, file: file.name, extracted: 0, skipped: "unsupported file type" });
        continue;
      }
      const extracted = await extractPipelineRecordsFromText(text).catch((err) => {
        console.warn(`[pipelineSharePointSource] Extraction failed for "${file.name}":`, err);
        return [];
      });
      items.push(...extracted);
      scan.push({ folder: folderPath, file: file.name, extracted: extracted.length });
    }
  }

  return { items, scan };
}
