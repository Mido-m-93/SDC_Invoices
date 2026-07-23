import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";

export const dynamic = "force-dynamic";

const FOLDER_PATHS: Record<string, string> = {
  pipeline: process.env.MICROSOFT_PIPELINE_FOLDER_PATH ?? "30_WorkTogether/02_Pipeline/10_Pipeline",
  contracts: process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts",
};

interface InspectedItem extends GraphDriveItem {
  children?: GraphDriveItem[];
}

// GET /api/debug/sharepoint-folder?which=pipeline|contracts
// Read-only inspection: lists a folder's immediate children, and one level
// into any subfolders, so we can see the real content shape (Excel tracker?
// per-deal subfolders? PDFs?) before building parsing/matching logic.
export async function GET(req: NextRequest) {
  const which = req.nextUrl.searchParams.get("which");
  if (!which || !FOLDER_PATHS[which]) {
    return NextResponse.json(
      { error: `?which= must be one of: ${Object.keys(FOLDER_PATHS).join(", ")}` },
      { status: 400 }
    );
  }

  const hasAzureCreds = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET
  );
  if (!hasAzureCreds) {
    return NextResponse.json({ error: "AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET not configured" }, { status: 500 });
  }

  const folderPath = FOLDER_PATHS[which];

  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const topLevel = await listFolderChildren(siteId, folderPath, token);

    const items: InspectedItem[] = await Promise.all(
      topLevel.map(async (item) => {
        if (!item.isFolder) return item;
        try {
          const children = await listItemsByFolderId(siteId, item.id, token);
          return { ...item, children };
        } catch (err) {
          return { ...item, children: [], _childError: String(err) } as InspectedItem;
        }
      })
    );

    return NextResponse.json({ sitePath: DEFAULT_SITE_PATH, siteId, folderPath, itemCount: items.length, items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
