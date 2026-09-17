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
  extractBudgetFromPdf,
  extractBudgetFromDocx,
  extractBudgetFromText,
  hasAnyBudgetField,
  type ExtractedBudgetFields,
} from "../ai/budgetExtractor";

// Budgets live in 30_WorkTogether, same root as Proposals. Override via
// comma-separated env var.
const BUDGET_FOLDER_PATHS = (process.env.MICROSOFT_BUDGET_FOLDER_PATH ?? "30_WorkTogether")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Runs `fn` over `items` with at most `limit` in flight at once — same
// rationale as proposalSharePointSource.ts's copy.
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

// Only files whose names suggest a budget/cost-plan document.
function looksLikeBudget(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("budget") ||
    lower.includes("予算") ||
    lower.includes("budget plan") ||
    lower.includes("cost plan") ||
    lower.includes("見積予算")
  );
}

async function fileToExtracted(
  siteId: string,
  token: string,
  item: GraphDriveItem,
): Promise<ExtractedBudgetFields | null> {
  const lower = item.name.toLowerCase();
  try {
    const bytes = await downloadFileById(siteId, item.id, token);
    const u8 = new Uint8Array(bytes);

    if (lower.endsWith(".pdf")) {
      return await extractBudgetFromPdf(u8);
    }
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      return await extractBudgetFromDocx(u8);
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const { read, utils } = await import("xlsx");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wb = read(Buffer.from(bytes), { cellDates: true } as any);
      const text = wb.SheetNames
        .map((name) => `Sheet: ${name}\n${utils.sheet_to_csv(wb.Sheets[name])}`)
        .join("\n\n");
      return await extractBudgetFromText(text);
    }
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      const text = Buffer.from(bytes).toString("utf-8");
      return await extractBudgetFromText(text);
    }
    return null;
  } catch (err) {
    console.warn(`[budgetSharePointSource] Failed to read "${item.name}":`, err);
    return null;
  }
}

export interface BudgetScanItem {
  fields: ExtractedBudgetFields;
  fileName: string;
  fileUrl: string | null;
  folder: string;
  fileId: string;
}

export interface BudgetScanDetail {
  folder: string;
  file: string;
  extracted: boolean;
  skipped?: string;
}

export async function fetchSharePointBudgets(): Promise<{
  items: BudgetScanItem[];
  scan: BudgetScanDetail[];
}> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const items: BudgetScanItem[] = [];
  const scan: BudgetScanDetail[] = [];

  for (const folderPath of BUDGET_FOLDER_PATHS) {
    let topLevel: GraphDriveItem[];
    try {
      topLevel = await listFolderChildren(siteId, folderPath, token);
    } catch (err) {
      scan.push({ folder: folderPath, file: "(folder)", extracted: false, skipped: `folder not accessible: ${String(err)}` });
      continue;
    }

    // Gather files: immediate + one level into subfolders + one more level
    // (same depth as proposal sync).
    const files: GraphDriveItem[] = [];
    const directFiles = topLevel.filter((e) => !e.isFolder);
    files.push(...directFiles);

    const subfolders = topLevel.filter((e) => e.isFolder);
    await mapWithConcurrency(subfolders, 6, async (entry) => {
      try {
        const children = await listItemsByFolderId(siteId, entry.id, token);
        const subFiles = children.filter((c) => !c.isFolder);
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
      if (looksLikeBudget(file.name)) return true;
      scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "not a budget file" });
      return false;
    });

    await mapWithConcurrency(candidateFiles, 4, async (file) => {
      const fields = await fileToExtracted(siteId, token, file);
      if (!fields || !hasAnyBudgetField(fields)) {
        scan.push({ folder: folderPath, file: file.name, extracted: false, skipped: "no extractable fields" });
        return;
      }
      items.push({ fields, fileName: file.name, fileUrl: file.webUrl ?? null, folder: folderPath, fileId: file.id });
      scan.push({ folder: folderPath, file: file.name, extracted: true });
    });
  }

  return { items, scan };
}
