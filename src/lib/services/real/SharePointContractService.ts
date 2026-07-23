// src/lib/services/real/SharePointContractService.ts
// Fetches invoice PDF attachments and member contracts from SharePoint via Graph API.

import "server-only";
import { extractContractFields, type ExtractedContractFields } from "@/lib/services/ai/contractExtractor";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

const SP_SITE             = process.env.MICROSOFT_MEMBER_SITE_PATH
  ?? "robocp.sharepoint.com:/sites/RoboCo-opSharedFiles:";
// Falls back to MICROSOFT_MEMBER_FOLDER_PATH too — /api/members/sync reads that
// same env var for the identical folder, so if only one of the two is actually
// configured in the deployment, both code paths still agree on where to look.
const SP_CONTRACTS_FOLDER = process.env.MICROSOFT_CONTRACTS_FOLDER_PATH
  ?? process.env.MICROSOFT_MEMBER_FOLDER_PATH
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

// ── Member name extraction (mirrors /api/members/sync logic) ─────────────────

function extractMemberName(rawName: string): string {
  let name = rawName;
  name = name.replace(/\.[^.]+$/, "");
  name = name.replace(/^\d+\s*[_\-\.]\s*/, "");
  name = name.replace(/[_\-]+/g, " ");
  name = name.replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4})(\s+.*)?$/gi, "");
  return name.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function tokenizeForMatch(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
}

export interface ContractCheckResult {
  matched: boolean;
  contractFileName: string | null;
  /** Extracted fields from the contract PDF. Null if not matched or PDF read failed. */
  contractInfo: ExtractedContractFields | null;
  /** Set when contractInfo is null because the PDF download/AI extraction step failed. */
  extractionError: string | null;
}

// Internal: list every item (both files AND subfolders) in the contracts folder.
// Members can be stored as direct PDF files OR as subfolders containing their PDF.
interface MemberItem {
  id: string;
  name: string;
  siteId: string;
  isFolder: boolean;
}

async function listAllMemberItems(token: string, siteId: string): Promise<MemberItem[]> {
  const folder = SP_CONTRACTS_FOLDER.split("/").map(encodeURIComponent).join("/");
  const data = await graphGet<{
    value?: Array<{ id: string; name: string; file?: object; folder?: object }>;
  }>(
    `/sites/${siteId}/drive/root:/${folder}:/children?$top=200&$select=id,name,file,folder`,
    token,
  );
  return (data.value ?? []).map((item) => ({
    id:       item.id,
    name:     item.name,
    siteId,
    isFolder: !!item.folder,
  }));
}

// Internal: find the first PDF inside a subfolder.
async function findPdfInFolder(
  token: string,
  siteId: string,
  folderId: string,
): Promise<{ id: string; name: string } | null> {
  const data = await graphGet<{ value?: Array<{ id: string; name: string; file?: object }> }>(
    `/sites/${siteId}/drive/items/${folderId}/children?$select=id,name,file`,
    token,
  );
  const pdf = (data.value ?? []).find(
    (item) => item.file && item.name.toLowerCase().endsWith(".pdf"),
  );
  return pdf ? { id: pdf.id, name: pdf.name } : null;
}

/**
 * Check whether a submitter has a contract in the SharePoint contracts folder.
 * Primary/authoritative member registration check — call this before local store lookups.
 * Handles two folder structures:
 *   - Direct PDF: 03_Member/MemberName.pdf
 *   - Subfolder:  03_Member/MemberName/業務委託基本契約書_MemberName.pdf
 * When matched, also downloads the PDF and extracts contract fields (amount, dates, scope).
 * Throws on network/auth failure so the caller can catch and fall back gracefully.
 */
export async function checkMemberBySharePointContracts(
  submitterName: string,
): Promise<ContractCheckResult> {
  const token = await getToken();
  const site  = await graphGet<{ id: string }>(`/sites/${SP_SITE}`, token);
  const items = await listAllMemberItems(token, site.id);
  const submitterNorm = normalizeForMatch(submitterName);

  console.log(
    `[SP check] Looking for "${submitterName}" (norm: "${submitterNorm}") among ${items.length} items:`,
  );
  items.forEach((item) => {
    const ext = extractMemberName(item.name);
    console.log(
      `  [${item.isFolder ? "folder" : "file"}] raw="${item.name}" → norm="${normalizeForMatch(ext)}"`,
    );
  });

  let matchedItem: MemberItem | null = null;

  // Pass 1: exact or containment match on space-stripped strings
  for (const item of items) {
    const extractedNorm = normalizeForMatch(extractMemberName(item.name));

    if (extractedNorm === submitterNorm) {
      matchedItem = item;
      break;
    }
    const shorter = Math.min(extractedNorm.length, submitterNorm.length);
    if (
      shorter >= 5 &&
      (extractedNorm.includes(submitterNorm) || submitterNorm.includes(extractedNorm))
    ) {
      matchedItem = item;
      break;
    }
  }

  // Pass 2: token overlap — at least 2 shared tokens covering ≥50% of the shorter name
  if (!matchedItem) {
    const submitterTokens = tokenizeForMatch(submitterName);
    let bestScore = 0;
    for (const item of items) {
      const extractedName  = extractMemberName(item.name);
      const extractedTokens = tokenizeForMatch(extractedName);
      const shared = submitterTokens.filter((t) => extractedTokens.includes(t));
      if (shared.length < 2) continue;
      const overlapRatio = shared.length / Math.min(submitterTokens.length, extractedTokens.length);
      if (overlapRatio < 0.5) continue;
      if (shared.length > bestScore) {
        bestScore    = shared.length;
        matchedItem  = item;
      }
    }
    if (matchedItem) {
      console.log(
        `[SP check] Token overlap match for "${submitterName}": "${matchedItem.name}" (shared tokens: ${bestScore})`,
      );
    }
  }

  if (!matchedItem) {
    console.log(`[SP check] No match found for "${submitterName}"`);
    return { matched: false, contractFileName: null, contractInfo: null, extractionError: null };
  }

  // Resolve the actual PDF — either the item itself or a file inside a subfolder
  let pdfId   = matchedItem.isFolder ? null : matchedItem.id;
  let pdfName = matchedItem.name;

  if (matchedItem.isFolder) {
    const pdf = await findPdfInFolder(token, matchedItem.siteId, matchedItem.id);
    if (pdf) { pdfId = pdf.id; pdfName = pdf.name; }
  }

  if (!pdfId) {
    // Folder exists but no PDF inside — member is registered, just no readable contract
    console.log(`[SP check] Folder matched for "${submitterName}" but no PDF inside`);
    return { matched: true, contractFileName: matchedItem.name, contractInfo: null, extractionError: null };
  }

  // Download and read the PDF with Claude
  let contractInfo: ExtractedContractFields | null = null;
  let extractionError: string | null = null;
  try {
    const bytes = await downloadContractById(matchedItem.siteId, pdfId);
    contractInfo = await extractContractFields(bytes);
    console.log(`[SP check] Contract read for "${submitterName}":`, contractInfo);
  } catch (err) {
    extractionError = String(err);
    console.warn(`[SP check] Contract PDF read failed for ${pdfName}:`, err);
  }

  return { matched: true, contractFileName: pdfName, contractInfo, extractionError };
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
