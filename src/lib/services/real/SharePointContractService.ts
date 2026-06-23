// src/lib/services/real/SharePointContractService.ts
// Fetches invoice PDF attachments and member contracts from SharePoint via Graph API.

import "server-only";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

const SP_SITE             = process.env.MICROSOFT_MEMBER_SITE_PATH
  ?? "robocp.sharepoint.com:/sites/RoboCo-opSharedFiles:";
const SP_CONTRACTS_FOLDER = process.env.MICROSOFT_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts/03_Member";

async function getToken(): Promise<string> {
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

async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface ContractFile {
  id:     string;
  name:   string;
  siteId: string;
}

// List all PDF files in the member contracts SharePoint folder.
export async function listContractFiles(): Promise<ContractFile[]> {
  const token  = await getToken();
  const site   = await graphGet<{ id: string }>(`/sites/${SP_SITE}`, token);
  const folder = SP_CONTRACTS_FOLDER.split("/").map(encodeURIComponent).join("/");
  const data   = await graphGet<{ value?: Array<{ id: string; name: string; file?: object }> }>(
    `/sites/${site.id}/drive/root:/${folder}:/children?$top=200&$select=id,name,file`,
    token,
  );
  return (data.value ?? [])
    .filter((item) => item.file)
    .map((item) => ({ id: item.id, name: item.name, siteId: site.id }));
}

// Download a contract file by its Drive item ID.
export async function downloadContractById(siteId: string, fileId: string): Promise<Uint8Array> {
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${fileId}/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Contract download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Download any SharePoint file by its public URL using the Graph shares endpoint.
// Works for MS Forms attachment URLs stored in invoiceAttachment.
export async function downloadSharePointFile(url: string): Promise<Uint8Array> {
  const token = await getToken();
  const encoded = Buffer.from(url)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`SharePoint file download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
