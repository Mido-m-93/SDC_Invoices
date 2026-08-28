// src/lib/services/real/graphClient.ts
// Shared Microsoft Graph API helper — token fetch, site resolution, folder
// listing, and file download. Extracted so new SharePoint sync features
// (pipeline sync, contract sync) don't add a 4th hand-rolled copy of this
// logic (SharePointContractService.ts, MicrosoftSheetsService.ts, and
// src/app/api/members/sync/route.ts each already have their own copy —
// those are left untouched; only new call sites use this module).

import "server-only";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

export const DEFAULT_SITE_PATH =
  process.env.MICROSOFT_MEMBER_SITE_PATH ?? "robocp.sharepoint.com:/sites/RoboCo-opSharedFiles:";

export async function getGraphToken(): Promise<string> {
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
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Graph token request failed");
  return data.access_token;
}

export async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function resolveSiteId(sitePath: string, token: string): Promise<string> {
  const site = await graphGet<{ id: string }>(`/sites/${sitePath}`, token);
  return site.id;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  size?: number;
}

function toDriveItems(
  value?: Array<{ id: string; name: string; file?: object; folder?: object; size?: number }>
): GraphDriveItem[] {
  return (value ?? []).map((item) => ({
    id:       item.id,
    name:     item.name,
    isFolder: !!item.folder,
    size:     item.size,
  }));
}

/** List the immediate children of a folder addressed by path, relative to the site's default drive root. */
export async function listFolderChildren(
  siteId: string,
  folderPath: string,
  token: string
): Promise<GraphDriveItem[]> {
  const folder = folderPath.split("/").map(encodeURIComponent).join("/");
  const data = await graphGet<{
    value?: Array<{ id: string; name: string; file?: object; folder?: object; size?: number }>;
  }>(
    `/sites/${siteId}/drive/root:/${folder}:/children?$top=200&$select=id,name,file,folder,size`,
    token
  );
  return toDriveItems(data.value);
}

/** List the immediate children of a folder addressed by its drive-item id (for recursing into subfolders). */
export async function listItemsByFolderId(
  siteId: string,
  folderId: string,
  token: string
): Promise<GraphDriveItem[]> {
  const data = await graphGet<{
    value?: Array<{ id: string; name: string; file?: object; folder?: object; size?: number }>;
  }>(
    `/sites/${siteId}/drive/items/${folderId}/children?$top=200&$select=id,name,file,folder,size`,
    token
  );
  return toDriveItems(data.value);
}

export interface GraphSearchResult {
  id: string;
  name: string;
  isFolder: boolean;
  webUrl: string;
  /** Folder path this item lives in, e.g. "/30_WorkTogether/03_Project/12_Acme" */
  parentPath: string;
}

/**
 * Live filename/folder-name search across the whole site's default drive,
 * via Graph's per-drive search endpoint (fast — an index lookup, not a
 * recursive folder crawl or file download). Used for on-demand "does
 * anything in SharePoint match this name" lookups, distinct from the
 * scheduled sync paths (pipelineSharePointSource.ts, proposalSharePointSource.ts)
 * which download and AI-extract file contents.
 */
export async function searchDriveItems(siteId: string, query: string, token: string): Promise<GraphSearchResult[]> {
  // OData string literals escape an embedded ' by doubling it — a raw
  // apostrophe in the query (e.g. a company name like "O'Brien K.K.") would
  // otherwise break out of the q='...' literal and 400 the request.
  const escaped = encodeURIComponent(query.replace(/'/g, "''"));
  const data = await graphGet<{
    value?: Array<{
      id: string;
      name: string;
      file?: object;
      folder?: object;
      webUrl?: string;
      parentReference?: { path?: string };
    }>;
  }>(`/sites/${siteId}/drive/root/search(q='${escaped}')?$top=25&$select=id,name,file,folder,webUrl,parentReference`, token);

  return (data.value ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    isFolder: !!item.folder,
    webUrl: item.webUrl ?? "",
    // parentReference.path looks like "/drive/root:/30_WorkTogether/03_Project" — strip the drive prefix
    parentPath: (item.parentReference?.path ?? "").replace(/^\/drive\/root:/, "") || "/",
  }));
}

export async function downloadFileById(siteId: string, fileId: string, token: string): Promise<Uint8Array> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${fileId}/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`File download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
