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
    for (const entry of topLevel) {
      if (!entry.isFolder) {
        files.push(entry);
        continue;
      }
      try {
        const children = await listItemsByFolderId(siteId, entry.id, token);
        const subFiles = children.filter((c) => !c.isFolder);
        // Check one more level in case proposals are nested under client folders
        for (const subEntry of children.filter((c) => c.isFolder)) {
          try {
            const grandChildren = await listItemsByFolderId(siteId, subEntry.id, token);
            subFiles.push(...grandChildren.filter((c) => !c.isFolder));
          } catch {
            // skip inaccessible grandchild folders
          }
        }
        files.push(...subFiles);
      } catch (err) {
        scan.push({ folder: folderPath, file: entry.name, extracted: false, skipped: `subfolder read failed: ${String(err)}` });
      }
    }

    for (const file of files) {
      if (!looksLikeProposal(file.name)) {
        scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "not a proposal file" });
        continue;
      }
      const fields = await fileToExtracted(siteId, token, file);
      if (!fields || !hasAnyProposalField(fields)) {
        scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "no extractable fields" });
        continue;
      }
      items.push({ fields, fileName: file.name, folder: folderPath, fileId: file.id });
      scan.push({ folder: folderPath, file: file.name, extracted: true });
    }
  }

  return { items, scan };
}
