import "server-only";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  type GraphDriveItem,
} from "./graphClient";

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
    lower.includes("cost plan") ||
    lower.includes("見積予算")
  );
}

export interface BudgetSharePointFile {
  fileName: string;
  fileUrl: string | null;
  folder: string;
  size: number | null;
}

// Read-only: scans SharePoint for budget-looking files and lists what's
// there. No extraction, no database writes, no matching — just sync
// (rescan) and display, same pattern as MembersContractTab.
export async function listSharePointBudgetFiles(): Promise<BudgetSharePointFile[]> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  const results: BudgetSharePointFile[] = [];

  for (const folderPath of BUDGET_FOLDER_PATHS) {
    let topLevel: GraphDriveItem[];
    try {
      topLevel = await listFolderChildren(siteId, folderPath, token);
    } catch {
      continue;
    }

    // Gather files: immediate + one level into subfolders + one more level
    // (same depth as the rest of the sync sources).
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
      } catch {
        // skip inaccessible subfolders
      }
    });

    for (const file of files) {
      if (!looksLikeBudget(file.name)) continue;
      results.push({ fileName: file.name, fileUrl: file.webUrl ?? null, folder: folderPath, size: file.size ?? null });
    }
  }

  return results;
}
