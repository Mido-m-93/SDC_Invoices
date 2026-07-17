// GET /api/debug/ms-forms-files
// Lists Excel files inside OneDrive/Apps/Microsoft Forms so you can find
// the correct MICROSOFT_EXPENSE_EXCEL_ITEM_ID value.
// Remove or protect this route before deploying to production.

import "server-only";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const OWNER_UPN     = process.env.MICROSOFT_OWNER_UPN!;

async function getAccessToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) throw new Error(`Token failed: ${data.error}`);
  return data.access_token;
}

interface DriveItem {
  id: string;
  name: string;
  webUrl?: string;
  folder?: object;
  file?: object;
  lastModifiedDateTime?: string;
}

export async function GET() {
  try {
    const token = await getAccessToken();

    // Resolve drive ID
    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${OWNER_UPN}/drive`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const { id: driveId } = await driveRes.json() as { id: string };

    const results: { path: string; id: string; name: string; webUrl?: string; lastModified?: string }[] = [];

    // Try to list Apps/Microsoft Forms folder
    const appsRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/Apps/Microsoft Forms:/children`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );

    let formFolders: DriveItem[] = [];
    if (appsRes.ok) {
      const appsData = await appsRes.json() as { value: DriveItem[] };
      formFolders = appsData.value.filter((i) => i.folder);

      // For each form folder, list its Excel files
      await Promise.all(
        formFolders.map(async (folder) => {
          const childRes = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folder.id}/children`,
            { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
          );
          if (!childRes.ok) return;
          const childData = await childRes.json() as { value: DriveItem[] };
          for (const item of childData.value) {
            if (item.file) {
              results.push({
                path: `Apps/Microsoft Forms/${folder.name}/${item.name}`,
                id:   item.id,
                name: item.name,
                webUrl: item.webUrl,
                lastModified: item.lastModifiedDateTime,
              });
            }
          }
        })
      );
    }

    // Search by keyword (covers any drive location, not just Apps folder)
    const searchRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='経費精算')`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const searchData = searchRes.ok
      ? (await searchRes.json() as { value: DriveItem[] }).value
      : [];

    return NextResponse.json({
      driveId,
      owner: OWNER_UPN,
      formFolders: formFolders.map((f) => f.name),
      excelFiles: results,
      searchResults: searchData.map((i) => ({ id: i.id, name: i.name, webUrl: i.webUrl })),
      hint: "Set MICROSOFT_EXPENSE_EXCEL_ITEM_ID to the 'id' of the expense form Excel file above.",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
