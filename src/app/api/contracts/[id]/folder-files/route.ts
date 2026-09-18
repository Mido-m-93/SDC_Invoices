// GET /api/contracts/[id]/folder-files
// Looks up the contract's real SharePoint folder (matched by clientName across
// the Client/Vendor/Partner contract categories) and lists its files — a
// read-only view so users can see what's actually in SharePoint for this
// contract without leaving the app.

import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";

// Below this, a folder name is too dissimilar from the client name to be
// worth surfacing even for a human to eyeball — avoids flooding the (still
// manual, click-to-link) file browser with obviously-unrelated folders.
const FUZZY_MATCH_THRESHOLD = 0.6;

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function describeMatch(siteId: string, token: string, category: string, match: GraphDriveItem) {
  if (!match.isFolder) {
    return { category, folderName: match.name, files: [{ name: match.name, isFolder: false, size: match.size ?? null, webUrl: match.webUrl ?? null }] };
  }
  const children = await listItemsByFolderId(siteId, match.id, token);
  return {
    category,
    folderName: match.name,
    files: children.map((c) => ({ name: c.name, isFolder: c.isFolder, size: c.size ?? null, webUrl: c.webUrl ?? null })),
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const contracts = await getContractService().listContracts();
    const contract = contracts.find((c) => c.id === params.id);
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    if (!contract.clientName) return NextResponse.json({ error: "Contract has no name to look up" }, { status: 400 });

    const targetName = contract.clientName.toLowerCase();
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

    let bestFuzzy: { category: string; item: GraphDriveItem; score: number } | null = null;

    for (const category of BUSINESS_SUBFOLDERS) {
      const folderPath = `${CONTRACTS_PARENT}/${category}`;
      let items: GraphDriveItem[];
      try {
        items = await listFolderChildren(siteId, folderPath, token);
      } catch {
        continue;
      }

      const match = items.find((item) => item.name.toLowerCase() === targetName);
      if (match) {
        return NextResponse.json(await describeMatch(siteId, token, category, match));
      }

      for (const item of items) {
        const score = similarity(contract.clientName, item.name);
        if (score >= FUZZY_MATCH_THRESHOLD && (!bestFuzzy || score > bestFuzzy.score)) {
          bestFuzzy = { category, item, score };
        }
      }
    }

    // No exact folder-name match anywhere — fall back to the closest
    // fuzzy match found across all categories, if any cleared the bar.
    // Still just a suggestion: nothing is saved until the user clicks
    // "Use as folder link" on a specific file.
    if (bestFuzzy) {
      return NextResponse.json({
        ...await describeMatch(siteId, token, bestFuzzy.category, bestFuzzy.item),
        fuzzyMatch: true,
      });
    }

    return NextResponse.json({ error: `No SharePoint folder found matching "${contract.clientName}"` }, { status: 404 });
  } catch (err) {
    console.error("[contracts/folder-files]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
