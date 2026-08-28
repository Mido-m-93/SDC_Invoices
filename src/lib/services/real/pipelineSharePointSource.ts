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

// Same client/project folders proposalSharePointSource already reads
// successfully (30_WorkTogether/03_Project/<client>, .../04_Partner/<client>).
// The dedicated pipeline tracker folder above turned out to hold nothing
// usable (a Windows shortcut, not real data) — this augments the tracker
// scan with pipeline signal pulled straight from each client's own folder.
const PROJECT_FOLDER_PATHS = (process.env.MICROSOFT_PROJECT_FOLDERS ?? "30_WorkTogether/03_Project,30_WorkTogether/04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Same cleanup regex used by proposalSharePointSource.ts (client folder
// names carry numeric prefixes and trailing project codes/dates) — kept
// local per this codebase's existing precedent of each sync service owning
// its own copy rather than sharing a util.
function cleanFolderName(rawName: string): string {
  return rawName
    .replace(/^\d+'?\s*[_\-.]\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4}(-\d{2,4})?)(\s+.*)?$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Runs `fn` over `items` with at most `limit` in flight — same rationale as
// proposalSharePointSource.ts's copy: Graph listing + AI extraction are both
// slow enough that a client-folder tree with dozens of clients would risk
// the route's timeout run one-at-a-time.
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

// Only the file types fileToText() can actually read — xlsx/csv/txt. docx/pdf
// client documents in these folders are already covered by the proposal sync
// path; re-reading them here would just double-extract the same content.
function hasSupportedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return [".xlsx", ".xls", ".csv", ".txt"].some((ext) => lower.endsWith(ext));
}

/**
 * Walk each client/project folder under 30_WorkTogether/03_Project and
 * .../04_Partner (MICROSOFT_PROJECT_FOLDERS), extract pipeline-shaped
 * records from every readable document inside, and use the (cleaned) folder
 * name as the authoritative client name — same rationale as
 * fetchClientFolderProposals() in proposalSharePointSource.ts: SharePoint is
 * already organized per-client, more reliable than free-text AI extraction
 * of a client name from document content.
 */
export async function fetchClientFolderPipelineItems(): Promise<{
  items: ExtractedPipelineItem[];
  scan: PipelineSourceScanDetail[];
}> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const items: ExtractedPipelineItem[] = [];
  const scan: PipelineSourceScanDetail[] = [];

  for (const parentPath of PROJECT_FOLDER_PATHS) {
    let clientFolders: GraphDriveItem[];
    try {
      clientFolders = (await listFolderChildren(siteId, parentPath, token)).filter((c) => c.isFolder);
    } catch (err) {
      scan.push({ folder: parentPath, file: "(folder)", extracted: 0, skipped: `folder not accessible: ${String(err)}` });
      continue;
    }

    const pending: Array<{ file: GraphDriveItem; clientName: string; folderLabel: string }> = [];

    await mapWithConcurrency(clientFolders, 6, async (clientFolder) => {
      const clientName = cleanFolderName(clientFolder.name);
      const folderLabel = `${parentPath}/${clientFolder.name}`;
      if (!clientName) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: 0, skipped: "could not derive client name from folder" });
        return;
      }

      let children: GraphDriveItem[];
      try {
        children = await listItemsByFolderId(siteId, clientFolder.id, token);
      } catch (err) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: 0, skipped: `subfolder read failed: ${String(err)}` });
        return;
      }

      const files = children.filter((c) => !c.isFolder && hasSupportedExtension(c.name));
      if (files.length === 0) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: 0, skipped: "no supported documents found" });
        return;
      }

      for (const file of files) pending.push({ file, clientName, folderLabel });
    });

    await mapWithConcurrency(pending, 4, async ({ file, clientName, folderLabel }) => {
      const text = await fileToText(siteId, token, file);
      if (!text) {
        scan.push({ folder: folderLabel, file: file.name, extracted: 0, skipped: "unsupported file type" });
        return;
      }
      const extracted = await extractPipelineRecordsFromText(text).catch((err) => {
        console.warn(`[pipelineSharePointSource] Extraction failed for "${file.name}":`, err);
        return [];
      });
      // Folder name is authoritative per client-folder structure — override
      // whatever AI extracted (or guessed) from the document content.
      const withFolderClientName = extracted.map((item) => ({ ...item, rawClientName: clientName }));
      items.push(...withFolderClientName);
      scan.push({ folder: folderLabel, file: file.name, extracted: extracted.length });
    });
  }

  return { items, scan };
}
