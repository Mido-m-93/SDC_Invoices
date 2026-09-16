// GET /api/contracts/[id]/folder-files
// Looks up the contract's real SharePoint folder (matched by clientName across
// the Client/Vendor/Partner contract categories) and lists its files — a
// read-only view so users can see what's actually in SharePoint for this
// contract without leaving the app.

import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

    for (const category of BUSINESS_SUBFOLDERS) {
      const folderPath = `${CONTRACTS_PARENT}/${category}`;
      let items: GraphDriveItem[];
      try {
        items = await listFolderChildren(siteId, folderPath, token);
      } catch {
        continue;
      }

      const match = items.find((item) => item.name.toLowerCase() === targetName);
      if (!match) continue;

      if (!match.isFolder) {
        return NextResponse.json({ category, folderName: match.name, files: [{ name: match.name, isFolder: false, size: match.size ?? null, webUrl: match.webUrl ?? null }] });
      }

      const children = await listItemsByFolderId(siteId, match.id, token);
      return NextResponse.json({
        category,
        folderName: match.name,
        files: children.map((c) => ({ name: c.name, isFolder: c.isFolder, size: c.size ?? null, webUrl: c.webUrl ?? null })),
      });
    }

    return NextResponse.json({ error: `No SharePoint folder found matching "${contract.clientName}"` }, { status: 404 });
  } catch (err) {
    console.error("[contracts/folder-files]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
