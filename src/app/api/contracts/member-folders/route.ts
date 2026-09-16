// POST /api/contracts/member-folders
// Read-only scan of the SharePoint 03_Member contract folder — lists each
// member's subfolder and the files inside it. No database writes, no
// matching/extraction: this is purely "sync (rescan) and show what's there".

import { NextResponse } from "next/server";
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
const MEMBER_FOLDER = process.env.MICROSOFT_MEMBER_CONTRACTS_FOLDER ?? "03_Member";

interface MemberFolderFile {
  name: string;
  isFolder: boolean;
  size: number | null;
  webUrl: string | null;
}

async function filesFor(siteId: string, token: string, item: GraphDriveItem): Promise<MemberFolderFile[]> {
  if (!item.isFolder) {
    return [{ name: item.name, isFolder: false, size: item.size ?? null, webUrl: item.webUrl ?? null }];
  }
  const children = await listItemsByFolderId(siteId, item.id, token);
  return children.map((c) => ({ name: c.name, isFolder: c.isFolder, size: c.size ?? null, webUrl: c.webUrl ?? null }));
}

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const folderPath = `${CONTRACTS_PARENT}/${MEMBER_FOLDER}`;

    const items = await listFolderChildren(siteId, folderPath, token);
    const members = await Promise.all(
      items.map(async (item) => ({
        name: item.name,
        webUrl: item.webUrl ?? null,
        files: await filesFor(siteId, token, item).catch(() => []),
      }))
    );

    return NextResponse.json({ members });
  } catch (err) {
    console.error("[contracts/member-folders]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
