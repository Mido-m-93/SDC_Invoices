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
import {
  extractProposalFromPdf,
  extractProposalFromDocx,
  extractProposalFromText,
  hasAnyProposalField,
  type ExtractedProposalFields,
} from "../ai/proposalExtractor";

// Proposals live in 30_WorkTogether. Override via comma-separated env var.
const PROPOSAL_FOLDER_PATHS = (process.env.MICROSOFT_PROPOSALS_FOLDER_PATH ?? "30_WorkTogether")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Client/project folders live directly under these parents (confirmed via
// SharePoint: 30_WorkTogether/03_Project/<client folder>, .../04_Partner/<client folder>).
// Every file inside a client's own folder is a proposal candidate — the
// folder itself is the client signal, so no filename keyword filter applies here.
const PROJECT_FOLDER_PATHS = (process.env.MICROSOFT_PROJECT_FOLDERS ?? "30_WorkTogether/03_Project,30_WorkTogether/04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Client folder names carry numeric prefixes and trailing project codes/dates,
// e.g. "0001_AssociateEnergy(SOL)_RPA_Dev_2205-2206" or "05_Deloitte" — strip
// those down to just the client name. Same regex chain used elsewhere for the
// same purpose (extractMemberName in members/sync/route.ts and
// SharePointContractService.ts, cleanFileName in BusinessContractSyncService.ts);
// kept local here per existing precedent of each sync service owning its copy.
function cleanFolderName(rawName: string): string {
  return rawName
    .replace(/^\d+'?\s*[_\-.]\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4}(-\d{2,4})?)(\s+.*)?$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Runs `fn` over `items` with at most `limit` in flight at once — Graph
// listing calls and AI extractions are both slow enough (network + model
// latency) that doing them one-at-a-time risks the route's 300s timeout
// once there are more than a handful of client folders/files.
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

// Only files whose names suggest a proposal/quote document
function looksLikeProposal(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("proposal") ||
    lower.includes("提案") ||
    lower.includes("見積") ||
    lower.includes("quote") ||
    lower.includes("quotation") ||
    lower.includes("offer") ||
    lower.includes("sow") ||
    lower.includes("statement of work") ||
    lower.includes("scope of work") ||
    lower.includes("プロポーザル")
  );
}

async function fileToExtracted(
  siteId: string,
  token: string,
  item: GraphDriveItem,
): Promise<ExtractedProposalFields | null> {
  const lower = item.name.toLowerCase();
  try {
    const bytes = await downloadFileById(siteId, item.id, token);
    const u8 = new Uint8Array(bytes);

    if (lower.endsWith(".pdf")) {
      return await extractProposalFromPdf(u8);
    }
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      return await extractProposalFromDocx(u8);
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const { read, utils } = await import("xlsx");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wb = read(Buffer.from(bytes), { cellDates: true } as any);
      const text = wb.SheetNames
        .map((name) => `Sheet: ${name}\n${utils.sheet_to_csv(wb.Sheets[name])}`)
        .join("\n\n");
      return await extractProposalFromText(text);
    }
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      const text = Buffer.from(bytes).toString("utf-8");
      return await extractProposalFromText(text);
    }
    return null;
  } catch (err) {
    console.warn(`[proposalSharePointSource] Failed to read "${item.name}":`, err);
    return null;
  }
}

export interface ProposalScanItem {
  fields: ExtractedProposalFields;
  fileName: string;
  folder: string;
  fileId: string;
}

export interface ProposalScanDetail {
  folder: string;
  file: string;
  extracted: boolean;
  skipped?: string;
}

export async function fetchSharePointProposals(): Promise<{
  items: ProposalScanItem[];
  scan: ProposalScanDetail[];
}> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const items: ProposalScanItem[] = [];
  const scan: ProposalScanDetail[] = [];

  for (const folderPath of PROPOSAL_FOLDER_PATHS) {
    let topLevel: GraphDriveItem[];
    try {
      topLevel = await listFolderChildren(siteId, folderPath, token);
    } catch (err) {
      scan.push({ folder: folderPath, file: "(folder)", extracted: false, skipped: `folder not accessible: ${String(err)}` });
      continue;
    }

    // Gather files: immediate + one level into subfolders (same depth as contract sync)
    const files: GraphDriveItem[] = [];
    const directFiles = topLevel.filter((e) => !e.isFolder);
    files.push(...directFiles);

    const subfolders = topLevel.filter((e) => e.isFolder);
    await mapWithConcurrency(subfolders, 6, async (entry) => {
      try {
        const children = await listItemsByFolderId(siteId, entry.id, token);
        const subFiles = children.filter((c) => !c.isFolder);
        // Check one more level in case proposals are nested under client folders
        const grandchildFolders = children.filter((c) => c.isFolder);
        await mapWithConcurrency(grandchildFolders, 6, async (subEntry) => {
          try {
            const grandChildren = await listItemsByFolderId(siteId, subEntry.id, token);
            subFiles.push(...grandChildren.filter((c) => !c.isFolder));
          } catch {
            // skip inaccessible grandchild folders
          }
        });
        files.push(...subFiles);
      } catch (err) {
        scan.push({ folder: folderPath, file: entry.name, extracted: false, skipped: `subfolder read failed: ${String(err)}` });
      }
    });

    const candidateFiles = files.filter((file) => {
      if (looksLikeProposal(file.name)) return true;
      scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "not a proposal file" });
      return false;
    });

    await mapWithConcurrency(candidateFiles, 4, async (file) => {
      const fields = await fileToExtracted(siteId, token, file);
      if (!fields || !hasAnyProposalField(fields)) {
        scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "no extractable fields" });
        return;
      }
      items.push({ fields, fileName: file.name, folder: folderPath, fileId: file.id });
      scan.push({ folder: folderPath, file: file.name, extracted: true });
    });
  }

  return { items, scan };
}

// Files considered inside a client's own folder — folder membership is
// already the client signal, so this is a much broader type list than
// looksLikeProposal (no keyword filter).
function looksLikeDocument(name: string): boolean {
  const lower = name.toLowerCase();
  return [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt"].some((ext) => lower.endsWith(ext));
}

/**
 * Walk each client/project folder under 30_WorkTogether/03_Project and
 * .../04_Partner (MICROSOFT_PROJECT_FOLDERS), extract every document inside,
 * and use the (cleaned) folder name as the authoritative client name —
 * SharePoint is already organized per-client, which is more reliable than
 * free-text AI extraction of a client name from document content.
 */
export async function fetchClientFolderProposals(): Promise<{
  items: ProposalScanItem[];
  scan: ProposalScanDetail[];
}> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const items: ProposalScanItem[] = [];
  const scan: ProposalScanDetail[] = [];

  for (const parentPath of PROJECT_FOLDER_PATHS) {
    let clientFolders: GraphDriveItem[];
    try {
      clientFolders = (await listFolderChildren(siteId, parentPath, token)).filter((c) => c.isFolder);
    } catch (err) {
      scan.push({ folder: parentPath, file: "(folder)", extracted: false, skipped: `folder not accessible: ${String(err)}` });
      continue;
    }

    // Listing each client folder's contents is a separate Graph round-trip —
    // do these concurrently, then extract concurrently too, so a parent with
    // dozens of client folders doesn't serialize into minutes of wall-clock.
    const pending: Array<{ file: GraphDriveItem; clientName: string; folderLabel: string }> = [];

    await mapWithConcurrency(clientFolders, 6, async (clientFolder) => {
      const clientName = cleanFolderName(clientFolder.name);
      const folderLabel = `${parentPath}/${clientFolder.name}`;
      if (!clientName) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: false, skipped: "could not derive client name from folder" });
        return;
      }

      let children: GraphDriveItem[];
      try {
        children = await listItemsByFolderId(siteId, clientFolder.id, token);
      } catch (err) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: false, skipped: `subfolder read failed: ${String(err)}` });
        return;
      }

      const files = children.filter((c) => !c.isFolder && looksLikeDocument(c.name));
      if (files.length === 0) {
        scan.push({ folder: folderLabel, file: "(folder)", extracted: false, skipped: "no documents found" });
        return;
      }

      for (const file of files) pending.push({ file, clientName, folderLabel });
    });

    await mapWithConcurrency(pending, 4, async ({ file, clientName, folderLabel }) => {
      const fields = await fileToExtracted(siteId, token, file);
      if (!fields || !hasAnyProposalField(fields)) {
        scan.push({ folder: folderLabel, file: file.name, extracted: false, skipped: "no extractable fields" });
        return;
      }
      // Folder name is authoritative per client-folder structure — override
      // whatever AI extracted from the document content.
      const withFolderClientName: ExtractedProposalFields = { ...fields, clientName };
      items.push({ fields: withFolderClientName, fileName: file.name, folder: folderLabel, fileId: file.id });
      scan.push({ folder: folderLabel, file: file.name, extracted: true });
    });
  }

  return { items, scan };
}
